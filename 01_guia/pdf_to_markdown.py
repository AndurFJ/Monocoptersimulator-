"""
PDF a Markdown Converter
========================
Convierte archivos PDF a formato Markdown (.md).
Soporta: texto, tablas, encabezados, listas, negritas, código.
Dependencias: pypdf >= 6.0
Uso:
  python pdf_to_markdown.py <archivo.pdf> [--out <archivo.md>]
  python pdf_to_markdown.py <archivo.pdf> --all-dir <carpeta_salida>
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("Error: se requiere 'pypdf'. Instalar con: pip install pypdf")
    sys.exit(1)


def escape_md(text: str) -> str:
    return (text.replace("\\", "\\\\").replace("|", "\\|").replace("*", "\\*")
            .replace("_", "\\_").replace("`", "\\`").replace("#", "\\#"))


def clean_line(line: str) -> str:
    line = line.strip()
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", line)


def detect_header_level(line: str) -> tuple[int, str] | None:
    m = re.match(r"^(#{1,6})\s+(.+)$", line)
    if m:
        return len(m.group(1)), m.group(2).strip()
    return None


def parse_table_lines(lines: list[str]) -> tuple[list[str], int] | None:
    if len(lines) < 2:
        return None
    for line in lines:
        if "|" not in line:
            return None
    sep_idx = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*\|[\s\-:|]+\|\s*$", line):
            sep_idx = i
            break
    if sep_idx is None or sep_idx == 0:
        return None
    ncols = lines[sep_idx].count("|") - 1
    if ncols < 1:
        return None
    return [l.strip() for l in lines[:sep_idx + 1]], ncols


def extract_page_text(page) -> str:
    raw_text = page.extract_text() or ""
    lines = raw_text.split("\n")
    md_lines: list[str] = []
    table_buffer: list[str] = []
    in_code_block = False
    code_lang = ""

    for line in lines:
        line = clean_line(line)

        if line.startswith("```"):
            if in_code_block:
                md_lines.append("```")
                in_code_block = False
                md_lines.append("")
            else:
                parts = line.split("```", 1)
                code_lang = parts[1].strip() if len(parts) > 1 else ""
                md_lines.append(f"```{code_lang}")
                in_code_block = True
            continue

        if in_code_block:
            md_lines.append(line)
            continue

        if not line:
            md_lines.append("")
            continue

        header = detect_header_level(line)
        if header:
            md_lines.append(f"{'#' * header[0]} {header[1]}")
            md_lines.append("")
            continue

        if "|" in line and not line.startswith("#"):
            table_buffer.append(line)
            continue
        elif table_buffer:
            parsed = parse_table_lines(table_buffer)
            if parsed:
                table_lines, ncols = parsed
                headers = [c.strip() for c in table_lines[0].split("|") if c.strip()]
                md_lines.append("")
                md_lines.append("| " + " | ".join(headers) + " |")
                md_lines.append("|" + "|".join(["---"] * len(headers)) + "|")
                for tl in table_lines[1:]:
                    cells = [c.strip() for c in tl.split("|") if c.strip()]
                    md_lines.append("| " + " | ".join(cells) + " |")
                md_lines.append("")
            else:
                for bl in table_buffer:
                    md_lines.append(bl)
                md_lines.append("")
            table_buffer = []

        if re.match(r"^[\-\*]\s+", line):
            md_lines.append(line)
            continue
        if re.match(r"^\d+\.\s+", line):
            md_lines.append(line)
            continue

        if "**" in line:
            line = re.sub(r"\*\*(.+?)\*\*", r"**\1**", line)
        if "__" in line:
            line = re.sub(r"__(.+?)__", r"**\1**", line)

        md_lines.append(escape_md(line))

    result = "\n".join(md_lines)
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip() + "\n"


def pdf_to_markdown(pdf_path: str, output_path: str | None = None) -> str:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"No se encontró: {pdf_path}")

    reader = PdfReader(str(pdf_path))
    n_pages = len(reader.pages)
    filename = pdf_path.stem

    all_md = [
        f"# {filename}", "",
        f"> **Documento convertido de:** `{pdf_path.name}`",
        f"> **Páginas:** {n_pages}",
        f"> **Fecha de conversión:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "", "---", ""
    ]

    for page_num, page in enumerate(reader.pages, start=1):
        all_md.append(f"## Página {page_num}")
        all_md.append("")
        all_md.append(extract_page_text(page))
        all_md.append("")
        all_md.append("---")
        all_md.append("")

    result = "\n".join(all_md).strip() + "\n"

    if output_path:
        Path(output_path).write_text(result, encoding="utf-8")
        print(f"[OK] Markdown guardado en: {output_path}")

    return result


def batch_convert(pdf_dir: str, output_dir: str | None = None) -> None:
    pdf_dir = Path(pdf_dir)
    pdf_files = sorted(pdf_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"No se encontraron PDFs en: {pdf_dir}")
        return

    print(f"Encontrados {len(pdf_files)} PDF(s).")
    out_dir = Path(output_dir) if output_dir else pdf_dir / "markdown"
    out_dir.mkdir(parents=True, exist_ok=True)

    for pdf_file in pdf_files:
        print(f"  Procesando: {pdf_file.name}...")
        try:
            md_path = out_dir / (pdf_file.stem + ".md")
            pdf_to_markdown(str(pdf_file), str(md_path))
        except Exception as e:
            print(f"  [ERROR] {pdf_file.name}: {e}")

    print(f"\n[HECHO] Todos los archivos convertidos en: {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="🛠️  Conversor PDF → Markdown"
    )
    parser.add_argument("input", help="Archivo PDF o directorio con PDFs")
    parser.add_argument("-o", "--out", help="Archivo de salida .md")
    parser.add_argument("--all-dir", help="Directorio de salida para modo batch")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] No existe: {input_path}")
        sys.exit(1)

    if input_path.is_dir():
        out_dir = args.all_dir if args.all_dir else str(input_path / "markdown")
        batch_convert(str(input_path), out_dir)
    else:
        content = pdf_to_markdown(str(input_path), args.out)
        if not args.out:
            print(content)


if __name__ == "__main__":
    main()
