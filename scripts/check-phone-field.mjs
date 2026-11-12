/**
 * The phone field on the login screen: what you type is what you see, and what
 * you see is what gets sent.
 *
 * WHY THIS CHECK EXISTS
 *
 * A bug shipped on 2026-11-11 that would have stopped essentially every real
 * customer signing in. Indian mobile numbers start with 6-9, so nearly all of
 * them start with 9. The field's display transform was
 *
 *     value={phoneInput.replace(/^\+?91?/, '')}
 *
 * `^\+?9` matches a leading `9` unconditionally, so typing `96...` displayed
 * `6...` — the first digit vanished on every keystroke. The stored and sent
 * values were correct, so the API worked; the *screen* lied, and a customer who
 * saw `611990869` had no reason to trust anything else on the page.
 *
 * A second half of the same bug: `slice(0, 10)` on a pasted `+919611990869`
 * keeps the `91` and drops the last two real digits, silently becoming a
 * different number.
 *
 * This pins the round trip, because a phone field that mangles digits is a
 * shop with no door.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const screen = readFileSync(join(process.cwd(), 'apps/mobile/src/app/login.tsx'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}`);
    if (detail) console.log(`     ${detail}`);
    return;
  }
  console.log(`PASS ${label}`);
}

// Pull the two functions out of the source and run them, so the check tests the
// code that actually ships rather than a copy of it.
function extract(name) {
  const start = screen.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = screen.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < screen.length; i++) {
    if (screen[i] === '{') depth++;
    else if (screen[i] === '}') {
      depth--;
      if (depth === 0) return screen.slice(start, i + 1);
    }
  }
  return null;
}

const localSrc = extract('localDigits');
const normaliseSrc = extract('normalisePhone');
check('localDigits() exists in the source', Boolean(localSrc && /function localDigits\(/.test(localSrc)));
check('normalisePhone() exists in the source', Boolean(normaliseSrc && /function normalisePhone\(/.test(normaliseSrc)));

if (!localSrc || !normaliseSrc) {
  console.log('\nRESULT: cannot run — the functions were not found');
  process.exit(1);
}

// The functions are TypeScript; `new Function` needs plain JS. The signatures
// here are simple enough that stripping the annotations is safe and exhaustive,
// and the strip is applied to a COPY — the source itself is untouched.
const stripTypes = (src) => src
  .replace(/\(raw:\s*string\)/g, '(raw)')
  .replace(/\)\s*:\s*string\s*\{/g, ') {');

// eslint-disable-next-line no-new-func
const localDigits = new Function(`${stripTypes(localSrc)}; return localDigits;`)();
// eslint-disable-next-line no-new-func
const normalisePhone = new Function(
  `${stripTypes(localSrc)}\n${stripTypes(normaliseSrc)}; return normalisePhone;`
)();

console.log('\n=== 1. the display bug: a leading 9 must survive every keystroke ===');
// This is the regression. Before the fix, typing these produced a mangled field.
for (const typed of ['9', '96', '961', '9611', '96119', '961199', '9611990869']) {
  const stored = localDigits(typed);
  check(
    `typing "${typed}" shows all ${stored.length} of its own digits`,
    stored === typed,
    `stored "${stored}"`
  );
}

console.log('\n=== 2. the paste bug: a country code must not eat real digits ===');
// The field holds local digits; the wire gets E.164.
const roundTrip = [
  ['9611990869', '+919611990869'],
  ['9000000002', '+919000000002'],
  ['9845612345', '+919845612345'],
];
for (const [typed, expected] of roundTrip) {
  const stored = localDigits(typed);
  const sent = normalisePhone(stored);
  check(`typing "${typed}" keeps all 10 digits`, stored === typed, `stored "${stored}"`);
  check(`typing "${typed}" sends "${expected}"`, sent === expected, `sent "${sent}"`);
}

console.log('\n=== 3. a pasted international number keeps its local digits ===');
for (const [pasted, expectedLocal, expected] of [
  ['+919611990869', '9611990869', '+919611990869'],
  ['919611990869', '9611990869', '+919611990869'],
  ['9611990869', '9611990869', '+919611990869'],
]) {
  const stored = localDigits(pasted);
  check(`pasted "${pasted}" stores "${expectedLocal}"`, stored === expectedLocal, `stored "${stored}"`);
  check(`pasted "${pasted}" sends "${expected}"`, normalisePhone(stored) === expected, `sent "${normalisePhone(stored)}"`);
}

console.log('\n=== 4. junk is dropped, and short numbers are refused not guessed ===');
check('letters, spaces and dashes are dropped', localDigits('96-119 90a86b9') === '9611990869', localDigits('96-119 90a86b9'));
check('a 9-digit number is not padded to 10', localDigits('961199086').length === 9, localDigits('961199086'));
check(
  'a number that is not 10 digits is sent unchanged (so the length check refuses it)',
  normalisePhone('961199086') === '961199086',
  normalisePhone('961199086')
);
check('the field cannot hold more than 10 digits', localDigits('96119908699999') === '9611990869', localDigits('96119908699999'));

console.log('\n=== 5. the field renders exactly what it holds ===');
check(
  'the TextInput value is the stored digits, not a transformed copy',
  /value=\{phoneInput\}/.test(screen) && !/value=\{phoneInput\.replace/.test(screen),
  'found a transform on the value'
);
check(
  'onChangeText routes through localDigits, not an inline slice',
  /onChangeText=\{\(text\) => setPhoneInput\(localDigits\(text\)\)\}/.test(screen),
  'the input handler does not use localDigits'
);

console.log();
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('RESULT: all checks passed');
