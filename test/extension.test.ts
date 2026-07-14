import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  setCapabilities,
  setCellDimensions,
  visibleWidth,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import piMathExtension from "../src/index.js";

type EventHandler = (event: unknown, ctx: TestContext) => unknown;
type CommandHandler = (args: string, ctx: TestContext) => unknown;

interface TestContext {
  mode: "tui";
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

const identity = (text: string) => text;
const markdownTheme: MarkdownTheme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: (text) => `\x1b[38;2;181;189;104m${text}\x1b[39m`,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
};

function isImageLine(line: string): boolean {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

function imageLines(lines: string[]): string[] {
  return lines.filter(isImageLine);
}

function kittyImageCount(lines: string[]): number {
  return lines.join("\n").match(/\x1b_Ga=T,/gu)?.length ?? 0;
}

function imageColumns(line: string): number {
  const match = /(?:^|,)c=(\d+)(?:,|;)/.exec(line);
  assert.ok(match);
  return Number(match[1]);
}

test("extension injects terminal images without changing source messages", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  const originalRender = Markdown.prototype.render;
  const events = new Map<string, EventHandler[]>();
  const commands = new Map<string, CommandHandler>();
  const notifications: string[] = [];
  const context: TestContext = {
    mode: "tui",
    ui: { notify: (message) => notifications.push(message) },
  };
  const mockPi = {
    on(name: string, handler: EventHandler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
  } as unknown as ExtensionAPI;

  await piMathExtension(mockPi);
  try {
    assert.notEqual(Markdown.prototype.render, originalRender);

    const inlineSource = String.raw`Einstein wrote $E=mc^2$.`;
    const inline = new Markdown(inlineSource, 0, 0, markdownTheme);
    const inlineRendered = inline.render(80);
    assert.equal(kittyImageCount(inlineRendered), 1);
    assert.match(inlineRendered.join("\n"), /Einstein wrote .*\./u);
    assert.doesNotMatch(inlineRendered.join("\n"), /E=mc|\$E/u);
    assert.equal((inline as unknown as { text: string }).text, inlineSource);
    assert.deepEqual(inline.render(80), inlineRendered);
    assert.ok(inlineRendered.every((line) => visibleWidth(line) <= 80));

    const chineseSource = String.raw`若 \(n\) 有奇素因子 \(p\)，则保留句内公式。

- \(n=4\);`;
    const chinese = new Markdown(chineseSource, 0, 0, markdownTheme);
    const chineseRendered = chinese.render(80);
    assert.equal(kittyImageCount(chineseRendered), 3);
    assert.match(chineseRendered.join("\n"), /若 .* 有奇素因子 .*，则保留句内公式。/u);
    assert.match(chineseRendered.join("\n"), /- .*;/u);
    assert.doesNotMatch(chineseRendered.join("\n"), /\\\(|\\\)|n=4/u);
    assert.equal((chinese as unknown as { text: string }).text, chineseSource);
    assert.ok(chineseRendered.every((line) => visibleWidth(line) <= 80));

    const standaloneInline = new Markdown(String.raw`\(E=mc^2\)`, 0, 0, markdownTheme);
    assert.equal(kittyImageCount(standaloneInline.render(80)), 1);

    const displaySource = String.raw`Result:
$$
\frac{1}{2}
$$`;
    const display = new Markdown(displaySource, 0, 0, markdownTheme);
    const wideLines = display.render(80);
    const wideImage = imageLines(wideLines)[0];
    assert.ok(wideImage);
    const resultRow = wideLines.findIndex((line) => line.trim() === "Result:");
    const imageRow = wideLines.findIndex(isImageLine);
    assert.equal(imageRow, resultRow + 1);
    assert.doesNotMatch(wideLines.join("\n"), /\\frac|pi-math|```/u);

    const narrowImage = imageLines(display.render(40))[0];
    assert.ok(narrowImage);
    assert.equal(imageColumns(wideImage), imageColumns(narrowImage));
    assert.ok(wideImage.indexOf("\x1b_G") > narrowImage.indexOf("\x1b_G"));

    const centered = new Markdown("$$x$$", 3, 0, markdownTheme);
    const centeredImage = imageLines(centered.render(41))[0];
    assert.ok(centeredImage);
    assert.ok(centeredImage.indexOf("\x1b_G") >= 18);

    const boxedSource = String.raw`First:
\[
\boxed{f(a)}.
\]
Second:
\[
\boxed{x-a\text{ is a factor of }f(x)\iff f(a)=0}.
\]`;
    const boxed = new Markdown(boxedSource, 0, 0, markdownTheme);
    assert.equal(imageLines(boxed.render(80)).length, 2);
    assert.equal((boxed as unknown as { text: string }).text, boxedSource);

    const command = commands.get("math-render");
    assert.ok(command);
    await command!("off", context);
    const disabledSource = String.raw`$\frac{1}{2}$`;
    assert.match(new Markdown(disabledSource, 0, 0, markdownTheme).render(80).join("\n"), /\\frac/u);

    await command!("on", context);
    assert.equal(
      imageLines(new Markdown(disabledSource, 0, 0, markdownTheme).render(80)).length,
      1,
    );
    assert.ok(notifications.some((message) => message.includes("disabled")));
    assert.ok(notifications.some((message) => message.includes("enabled")));

    setCapabilities({ images: null, trueColor: true, hyperlinks: true });
    const unsupported = new Markdown("$$x+1$$", 0, 0, markdownTheme).render(80).join("\n");
    assert.match(unsupported, /\$\$x\+1\$\$/u);
  } finally {
    for (const handler of events.get("session_shutdown") ?? []) await handler({}, context);
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }

  assert.equal(Markdown.prototype.render, originalRender);
});
