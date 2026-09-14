import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

/** Tiny text-flow helper on top of pdf-lib: wraps paragraphs, paginates, returns bytes. */
export class SimpleDoc {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private bold!: PDFFont;
  private page!: PDFPage;
  private y = 0;
  private readonly margin = 64;
  private readonly width = 612;
  private readonly height = 792;
  private readonly size = 11;
  private readonly leading = 15;

  static async create(): Promise<SimpleDoc> {
    const d = new SimpleDoc();
    d.doc = await PDFDocument.create();
    d.font = await d.doc.embedFont(StandardFonts.TimesRoman);
    d.bold = await d.doc.embedFont(StandardFonts.TimesRomanBold);
    d.newPage();
    return d;
  }

  newPage(): void {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  private ensure(lines = 1): void {
    if (this.y - lines * this.leading < this.margin) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      for (const w of words) {
        const trial = line ? line + " " + w : w;
        if (font.widthOfTextAtSize(trial, size) > maxWidth && line) { out.push(line); line = w; }
        else line = trial;
      }
      out.push(line);
    }
    return out;
  }

  heading(text: string, size = 14): void {
    this.ensure(2);
    this.page.drawText(text, { x: this.margin, y: this.y, size, font: this.bold, color: rgb(0, 0, 0) });
    this.y -= size + 8;
  }

  para(text: string, opts: { bold?: boolean; indent?: number; size?: number } = {}): void {
    const font = opts.bold ? this.bold : this.font;
    const size = opts.size ?? this.size;
    const indent = opts.indent ?? 0;
    const lines = this.wrap(text, font, size, this.width - 2 * this.margin - indent);
    for (const l of lines) {
      this.ensure();
      this.page.drawText(l, { x: this.margin + indent, y: this.y, size, font });
      this.y -= this.leading;
    }
    this.y -= this.leading * 0.5;
  }

  lines(items: string[], opts: { bold?: boolean } = {}): void {
    for (const l of items) {
      this.ensure();
      this.page.drawText(l, { x: this.margin, y: this.y, size: this.size, font: opts.bold ? this.bold : this.font });
      this.y -= this.leading;
    }
    this.y -= this.leading * 0.5;
  }

  bullet(text: string): void {
    const lines = this.wrap(text, this.font, this.size, this.width - 2 * this.margin - 18);
    lines.forEach((l, i) => {
      this.ensure();
      if (i === 0) this.page.drawText("•", { x: this.margin + 4, y: this.y, size: this.size, font: this.font });
      this.page.drawText(l, { x: this.margin + 18, y: this.y, size: this.size, font: this.font });
      this.y -= this.leading;
    });
    this.y -= this.leading * 0.3;
  }

  space(n = 1): void { this.y -= this.leading * n; }

  async bytes(): Promise<Uint8Array> { return this.doc.save(); }
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Phoenix" });
}
export function fmtDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" });
}
