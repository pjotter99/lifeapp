// Web-Share-API mit Datei-Anhang, wenn verfuegbar (iOS: "In Dateien
// sichern" landet damit auf iCloud Drive) — sonst normaler Download
// (Desktop). CLAUDE.md, Abschnitt "Manuell: Datei teilen". Von Einstellungen
// (Sicherung exportieren) und Dashboard (Erinnerungskarte) genutzt.
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
