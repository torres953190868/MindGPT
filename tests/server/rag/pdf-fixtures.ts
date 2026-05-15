function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pageContent(lines: string[]) {
  const commands = lines
    .map((line, index) => {
      const font = index === 0 ? "/F1 18 Tf" : "/F1 12 Tf";
      const move = index === 0 ? "72 720 Td" : "0 -24 Td";
      return `${font} ${move} (${escapePdfText(line)}) Tj`;
    })
    .join("\n");
  return `BT\n${commands}\nET`;
}

export function createSyntheticPdf(pages: string[][]) {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const pageRefs: string[] = [];
  let nextObject = 4;
  for (const lines of pages) {
    const pageObject = nextObject;
    const contentObject = nextObject + 1;
    nextObject += 2;
    const content = pageContent(lines);
    objects[pageObject] = [
      "<< /Type /Page",
      "/Parent 2 0 R",
      "/MediaBox [0 0 612 792]",
      "/Resources << /Font << /F1 3 0 R >> >>",
      `/Contents ${contentObject} 0 R`,
      ">>",
    ].join(" ");
    objects[contentObject] = `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`;
    pageRefs.push(`${pageObject} 0 R`);
  }

  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(pdf, "utf8");
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }

  const startXref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}
