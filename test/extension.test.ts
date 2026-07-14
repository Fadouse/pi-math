import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import piMathExtension from "../src/index.js";

type EventHandler = (event: unknown, ctx: TestContext) => unknown;
type CommandHandler = (args: string, ctx: TestContext) => unknown;

interface TestContext {
  mode: "tui";
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
}

const identity = (text: string) => text;
const markdownTheme: MarkdownTheme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
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

test("extension renders display-only math and restores the Markdown prototype", async () => {
  const originalRender = Markdown.prototype.render;
  const events = new Map<string, EventHandler[]>();
  const commands = new Map<string, CommandHandler>();
  const notifications: string[] = [];
  const context: TestContext = {
    mode: "tui",
    ui: {
      notify(message) {
        notifications.push(message);
      },
    },
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
    const inlineOutput = inline.render(80).map((line) => line.trimEnd()).join("\n");
    assert.match(inlineOutput, /Einstein wrote E=mc²\./u);
    assert.equal((inline as unknown as { text: string }).text, inlineSource);

    const displaySource = String.raw`Result:
$$
\frac{1}{2}
$$`;
    const display = new Markdown(displaySource, 0, 0, markdownTheme);
    const displayOutput = display.render(80).map((line) => line.trimEnd()).join("\n");
    assert.match(displayOutput, /[─━]/u);
    assert.doesNotMatch(displayOutput, /\\frac|pi-math|```/u);
    assert.equal((display as unknown as { text: string }).text, displaySource);

    const wideBar = displayOutput.split("\n").find((line) => /[─━]/u.test(line));
    const narrowOutput = display.render(40).map((line) => line.trimEnd()).join("\n");
    const narrowBar = narrowOutput.split("\n").find((line) => /[─━]/u.test(line));
    assert.ok(wideBar && narrowBar);
    assert.ok(wideBar.search(/\S/u) > narrowBar.search(/\S/u));

    const centered = new Markdown("$$x$$", 3, 0, markdownTheme);
    const centeredLine = centered.render(41).find((line) => line.trim() === "x");
    assert.ok(centeredLine);
    assert.equal(centeredLine.search(/\S/u), 20);

    const boxedSource = String.raw`First:
\[
\boxed{f(a)}.
\]
Second:
\[
\boxed{x-a\text{ 是 }f(x)\text{ 的因式}\iff f(a)=0}.
\]`;
    const boxedMessage = new Markdown(boxedSource, 0, 0, markdownTheme);
    const boxedOutput = boxedMessage.render(80).map((line) => line.trimEnd()).join("\n");
    assert.match(boxedOutput, /│ f\(a\) │\./u);
    assert.match(boxedOutput, /│ x-a 是 f\(x\) 的因式⟺f\(a\)=0 │\./u);
    assert.doesNotMatch(boxedOutput, /\\boxed|pi-math|```/u);
    assert.equal((boxedMessage as unknown as { text: string }).text, boxedSource);

    const command = commands.get("math-render");
    assert.ok(command);
    await command!("off", context);

    const disabledSource = String.raw`$\frac{1}{2}$`;
    const disabled = new Markdown(disabledSource, 0, 0, markdownTheme);
    const disabledOutput = disabled.render(80).join("\n");
    assert.match(disabledOutput, /\\frac/u);

    await command!("on", context);
    const enabled = new Markdown(disabledSource, 0, 0, markdownTheme);
    assert.match(enabled.render(80).join("\n"), /[─━]/u);
    assert.ok(notifications.some((message) => message.includes("disabled")));
    assert.ok(notifications.some((message) => message.includes("enabled")));
  } finally {
    for (const handler of events.get("session_shutdown") ?? []) {
      await handler({}, context);
    }
  }

  assert.equal(Markdown.prototype.render, originalRender);
});
