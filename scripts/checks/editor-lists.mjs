// Lists while typing in the editor: Enter after an item starts the next one (numbers count up, tasks start
// unticked), Enter on an empty item ends the list, Tab / ⇧Tab move an item in and out a level (by the
// parent's marker width), and none of it happens in a code block or while an input method is composing.
import { openApp } from "../harness.mjs";

const app = await openApp({});
const { page } = app, bad = [];
const ta = page.locator(".p-ta").first();
const set = (text) => ta.evaluate((el, text) => { el.focus(); el.value = text; el.setSelectionRange(text.length, text.length); }, text);
const val = () => ta.inputValue();
async function want(label, typed, start, expect) {
  await set(start);
  for (const k of typed) k.length > 1 && !/^[a-z]$/.test(k) ? await page.keyboard.press(k) : await page.keyboard.type(k);
  const got = await val();
  if (got !== expect) bad.push(`${label}: want ${JSON.stringify(expect)}, got ${JSON.stringify(got)}`);
}
try {
  await page.click("#newBtn");
  await want("bullet continues", ["Enter", "b"], "- a", "- a\n- b");
  await want("number counts up", ["Enter", "x"], "1. a\n2. b", "1. a\n2. b\n3. x");
  await want("task starts unticked", ["Enter", "y"], "- [x] done", "- [x] done\n- [ ] y");
  await want("empty item ends the list", ["Enter"], "- a\n- ", "- a\n");
  await want("plain line is a plain newline", ["Enter", "z"], "plain", "plain\nz");
  await want("no list in a code block", ["Enter"], "```\n- a", "```\n- a\n");
  await want("Tab nests under a bullet", ["Tab"], "- a\n- b", "- a\n  - b");
  await want("Tab nests under a number by its width", ["Tab"], "1. a\n2. b", "1. a\n   2. b");
  await want("⇧Tab comes back out", ["Shift+Tab"], "- a\n  - b", "- a\n- b");
  await want("Tab on the first item stays", ["Tab"], "- a", "- a");
  // An input method's Enter (keyCode 229) picks characters and must not add a list marker.
  await set("- 中");
  await ta.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true })));
  if ((await val()) !== "- 中") bad.push(`composing Enter changed the text: ${JSON.stringify(await val())}`);
  // Undo takes the new marker back in one step.
  await want("undo", ["Enter", "ControlOrMeta+z"], "- a", "- a");
} finally {
  await app.close();
}
if (bad.length) { console.error("FAIL editor-lists\n  " + bad.join("\n  ")); process.exit(1); }
console.log("ok   editor-lists");
