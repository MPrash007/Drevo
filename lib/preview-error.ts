export function summarizePreviewError(message: string) {
  const firstLine = message.split(/\r?\n/, 1)[0].trim();
  const wrapped = firstLine.match(/^Cannot assign to read only property 'message' of object '(.+)'$/);
  return (wrapped?.[1] ?? firstLine).slice(0, 400) || "An error occurred in the preview.";
}
