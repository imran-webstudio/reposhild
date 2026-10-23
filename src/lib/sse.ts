export async function readSse(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The scan response had no stream.");
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (frame: string) => {
    if (!frame.trim()) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    onEvent(event, JSON.parse(dataLines.join("\n")));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) flush(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}
