import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CANON = json.loads((ROOT / "magefort-canon.json").read_text(encoding="utf-8"))
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)

MODELS = [os.environ["MODEL"]]

PROFILES = {
    "konservativ": {"temperature": 0.30, "top_p": 0.80, "repeat_penalty": 1.08},
    "ausgewogen": {"temperature": 0.65, "top_p": 0.90, "repeat_penalty": 1.06},
    "kreativ": {"temperature": 1.00, "top_p": 0.95, "repeat_penalty": 1.04},
}

SYSTEM = f"""Du bist die Erzählinstanz eines interaktiven deutschen Rollenspiels in Magefort Castle.

BINDENDER KANON:
{json.dumps(CANON, ensure_ascii=False)}

Regeln für jede Antwort:
- Der Kanon ist bindend. Widersprich ihm niemals und behandle offene Punkte nicht als gesicherte Weltfakten.
- extendedCanonDefault ist false: Figuren aus 'erweiterter_kanon' erscheinen nicht, sofern die Spielanweisung sie nicht ausdrücklich aktiviert.
- Erfinde keine neuen permanenten Schlossbereiche, Institutionen oder Weltregeln und stelle Unbelegtes nicht als feststehenden Buchkanon dar.
- Pferde verhalten sich im Normalfall glaubwürdig pferdisch. Sie führen keine normalen Gespräche und betreten keine Wohn-, Unterrichts-, Speise-, Büro- oder sonstigen Schlossräume.
- Magie folgt Element, Verbund, Beziehung, Übung und Erschöpfung. Keine beliebigen Superkräfte und keine permanente Telepathie.
- Schreibe idiomatisches, lebendiges Deutsch in der Du-Perspektive. Keine Meta-Kommentare über Kanon, Prompt oder Regeln.
- Figuren sollen ihre kanonische Persönlichkeit zeigen statt austauschbare Erklärfiguren zu sein.
- Erzähle konkrete Handlung, Beziehungen und Atmosphäre. Vermeide pädagogische Minispiele, Rätselketten aus Hinweisschildern und generische 'magische Aufgabe'-Strukturen.
- Ein Spielknoten umfasst ungefähr 180 bis 300 Wörter Geschichte und danach exakt drei kurze, deutlich verschiedene Handlungsoptionen.
- Beende jeden Knoten mit der Zeile 'Wie reagierst du?' und drei nummerierten Optionen, die jeweils mit 'Du ' beginnen.
- Entscheide niemals selbst, welche Option die Spielerfigur nimmt.
"""

START_PROMPT = """Zeitstufe: Unmittelbare Nachkriegszeit.
Die Spielerfigur ist bereits Schülerin oder Schüler in Magefort, aber Name, Pferd und eigenes Element sind absichtlich NICHT festgelegt. Erfinde diese drei Dinge nicht.
Beginne eine neue, spannende Geschichte an einem kanonisch belegten Ort. Nutze zwei bis vier bekannte Figuren, deren Rollen zur Zeitstufe passen. Ausgangspunkt darf alltäglich sein, soll aber organisch in ein ungewöhnliches Problem, Geheimnis oder Abenteuer kippen. Jonathan oder Ethan müssen nicht vorkommen.
Schreibe jetzt nur den ersten Spielknoten mit drei echten Fortsetzungsmöglichkeiten."""

CONTINUE_PROMPT = """Ich entscheide mich für die zweite angebotene Möglichkeit. Setze unmittelbar dort fort, ohne den bisherigen Text zusammenzufassen. Entwickle die Situation spürbar weiter und ende wieder mit exakt drei neuen Möglichkeiten."""

TRAP_PROMPT = """Aktuelle Szene: Du und Sarah stehen mit Luna auf der zentralen Koppel. Ihr habt draußen etwas Merkwürdiges bemerkt und wollt im Speisesaal mit den anderen darüber reden.
Ich möchte, dass Luna mit Sarah in den Speisesaal kommt und uns dort in klaren Worten erzählt, was sie draußen gesehen hat. Setze die Geschichte entsprechend fort und gib danach drei Möglichkeiten."""


def post_chat(model, messages, profile, max_tokens=460):
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            **profile,
            "seed": 4242,
            "num_ctx": 8192,
            "num_predict": max_tokens,
        },
        "keep_alive": "2m",
    }
    if model.startswith("qwen3.5"):
        payload["think"] = False
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=1200) as resp:
        obj = json.loads(resp.read().decode("utf-8"))
    obj["wall_seconds"] = round(time.time() - started, 3)
    return obj


def record(rows, model, profile_name, scenario, response_obj):
    msg = response_obj.get("message") or {}
    eval_count = response_obj.get("eval_count") or 0
    eval_duration = response_obj.get("eval_duration") or 0
    tok_s = round(eval_count / (eval_duration / 1e9), 2) if eval_count and eval_duration else None
    rows.append({
        "model": model,
        "profile": profile_name,
        "scenario": scenario,
        "content": msg.get("content", ""),
        "thinking": msg.get("thinking", ""),
        "wall_seconds": response_obj.get("wall_seconds"),
        "prompt_eval_count": response_obj.get("prompt_eval_count"),
        "eval_count": eval_count,
        "tokens_per_second": tok_s,
        "prompt_eval_duration": response_obj.get("prompt_eval_duration"),
        "eval_duration": eval_duration,
        "total_duration": response_obj.get("total_duration"),
    })
    print(f"DONE {model} {profile_name} {scenario}", flush=True)


def main():
    model = MODELS[0]
    rows, failures = [], []
    print(f"### PULL {model}", flush=True)
    pull = subprocess.run(["ollama", "pull", model], text=True, capture_output=True, timeout=2400)
    if pull.returncode != 0:
        failures.append({"model": model, "stage": "pull", "stderr": pull.stderr[-8000:]})
    else:
        try:
            for profile_name, profile in PROFILES.items():
                try:
                    start = post_chat(model, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": START_PROMPT}], profile)
                    record(rows, model, profile_name, "start", start)
                    if profile_name == "ausgewogen":
                        start_text = (start.get("message") or {}).get("content", "")
                        cont = post_chat(model, [
                            {"role": "system", "content": SYSTEM},
                            {"role": "user", "content": START_PROMPT},
                            {"role": "assistant", "content": start_text},
                            {"role": "user", "content": CONTINUE_PROMPT},
                        ], profile)
                        record(rows, model, profile_name, "continue_second_option", cont)
                        trap = post_chat(model, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TRAP_PROMPT}], profile, 440)
                        record(rows, model, profile_name, "canon_trap", trap)
                except Exception as exc:
                    failures.append({"model": model, "profile": profile_name, "stage": "generation", "error": repr(exc)})
        finally:
            subprocess.run(["ollama", "rm", model], text=True, capture_output=True, timeout=300)

    safe_model = model.replace(":", "-").replace("/", "-")
    payload = {"meta": {"model": model, "profiles": PROFILES, "seed": 4242, "num_ctx": 8192}, "rows": rows, "failures": failures}
    (OUT / f"{safe_model}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"FINAL rows={len(rows)} failures={len(failures)}", flush=True)


if __name__ == "__main__":
    main()
