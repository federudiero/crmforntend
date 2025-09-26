// src/lib/exporters.js
// Exporta a Excel y PDF usando imports dinámicos para no inflar el bundle.
export async function exportRowsToXLSX(filename, rows) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function exportHtmlToPDF(filename, element) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.html(element, {
    callback: (d) => {
      d.save(filename);
    },
    x: 10, y: 10, width: 180
  });
}
 