import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import piMathExtension from "../src/index.js";

const theoryLatex = readFileSync(new URL("./fixtures/field-theory.tex", import.meta.url), "utf8");

const fixtures: Record<string, string> = {
  aligned: String.raw`## Embedded boxed result

\[
\begin{aligned}
CE^2+DE^2
&=(10-2\sqrt{10})^2
 +2\cdot20(\sqrt{10}-1)\\
&=(140-40\sqrt{10})+(40\sqrt{10}-40)\\
&=\boxed{100}.
\end{aligned}
\]`,
  complex: String.raw`## Spacing, bounds, and aligned continuation

\[
\boxed{
\begin{aligned}
\frac{\partial}{\partial t}\Psi(\mathbf{x},t)
&=
\left[
-\frac{i}{\hbar}
\left(
-\frac{\hbar^2}{2m}\nabla^2
+V(\mathbf{x},t)
+\lambda\left|\Psi(\mathbf{x},t)\right|^2
\right)
-\gamma
\right]\Psi(\mathbf{x},t) \\[4pt]
&\quad
+\int_{\mathbb{R}^3}
K(\mathbf{x},\mathbf{y})
\exp\!\left(
-\frac{\|\mathbf{x}-\mathbf{y}\|^2}{2\sigma^2}
\right)
\Psi(\mathbf{y},t)\,d^3\mathbf{y}
+\sum_{n=1}^{\infty}
\frac{(-1)^{n+1}}{n!}
\left(\frac{\partial^n\Psi}{\partial t^n}\right)
e^{-n\alpha t}.
\end{aligned}
}
\]`,
  radical: String.raw`## Continuous radical overline

\[
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
\]`,
  theory: `## Structured field-theory regression\n\n\\[\n${theoryLatex}\n\\]`,
  gallery: String.raw`## Geometry regression gallery

\[
EM=OE\cos45^\circ
\]
\[
(5\sqrt2-2\sqrt5)\frac{\sqrt2}{2}=5-\sqrt{10}.
\]
\[
\int_{\mathbb R^3}^{\infty}f(x)\,dx
\]
\[
e^x=\sum_{n=0}^{\infty}\frac{x^n}{n!}
\]
\[
f(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}
\]`,
  inline: String.raw`## Variational calculus in a single Markdown response

Let \(q:[t_0,t_1]\to\mathbb{R}^n\) be a smooth path with fixed endpoints, and let \(L(q,\dot q,t)\) be its Lagrangian. The action is \(S[q]=\int_{t_0}^{t_1}L(q,\dot q,t)\,dt\).

For a variation \(q_\varepsilon=q+\varepsilon\eta\), where \(\eta(t_0)=\eta(t_1)=0\), differentiate under the integral and integrate the velocity term by parts:

\[
\begin{aligned}
\delta S[q;\eta]
&=\left.\frac{d}{d\varepsilon}S[q_\varepsilon]\right|_{\varepsilon=0} \\[3pt]
&=\int_{t_0}^{t_1}\left(
\frac{\partial L}{\partial q}\cdot\eta
 +\frac{\partial L}{\partial\dot q}\cdot\dot\eta
\right)dt \\[3pt]
&=\left[\frac{\partial L}{\partial\dot q}\cdot\eta\right]_{t_0}^{t_1}
 +\int_{t_0}^{t_1}\left(
\frac{\partial L}{\partial q}
 -\frac{d}{dt}\frac{\partial L}{\partial\dot q}
\right)\cdot\eta\,dt.
\end{aligned}
\]

The boundary term vanishes. Because \(\eta\) is arbitrary, the fundamental lemma gives the Euler–Lagrange equation

\[
\boxed{\frac{d}{dt}\frac{\partial L}{\partial\dot q}-\frac{\partial L}{\partial q}=0}.
\]

For \(L=\tfrac12m\dot q^{\,2}-V(q)\), this becomes \(m\ddot q=-\nabla V(q)\). If \(L\) has no explicit time dependence, the corresponding conserved quantity is

\[
E=\dot q\cdot\frac{\partial L}{\partial\dot q}-L,
\qquad
\frac{dE}{dt}=0.
\]

The same notation remains readable inside prose: for the harmonic oscillator \(V(q)=\tfrac12m\omega^2q^2\), the solution \(q(t)=A\cos(\omega t)+B\sin(\omega t)\) traces an ellipse in phase space, while \(E=\tfrac12m\dot q^{\,2}+\tfrac12m\omega^2q^2\) stays constant.`,
};

const fixtureName = process.argv[2] ?? "aligned";
const source = fixtures[fixtureName];
if (!source) throw new Error(`Unknown fixture: ${fixtureName}`);

const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
const mockPi = {
  on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
    const registered = handlers.get(name) ?? [];
    registered.push(handler);
    handlers.set(name, registered);
  },
  registerCommand() {},
} as unknown as ExtensionAPI;

initTheme("dark");
await piMathExtension(mockPi);

const requestedWidth = process.env.MATH_WIDTH ?? String(process.stdout.columns ?? 100);
const width = Number.parseInt(requestedWidth, 10);
const markdown = new Markdown(source, 1, 0, getMarkdownTheme());
const lines = markdown.render(Number.isFinite(width) ? width : 100);
process.stdout.write(`\x1b[2J\x1b[H${lines.map((line) => line.trimEnd()).join("\n")}\x1b[0m\n`);

for (const handler of handlers.get("session_shutdown") ?? []) {
  await handler({}, {});
}
