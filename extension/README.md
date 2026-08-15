# Harper Autofill

A Chrome extension that fills a payment page's bank details in one click: name of account
holder, account holder type, account type, account number, the confirmation box, routing
number, the autopay toggle, and the Terms of Use checkbox.

Enter the details once. After that it is a single click, every time.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this `extension/` folder.
4. Pin **Harper Autofill** to the toolbar so it is one click away.

There is no build step. The folder you check out is the extension you load.

## Use

1. Click the toolbar icon.
2. First time only: type the account holder name, account number, and routing number, and pick
   the two dropdown values. Everything saves as you type — there is no Save button.
3. On the payment page, click the icon and press **Fill this page**.

Or skip the panel entirely with `Ctrl+Shift+Y` (`⌘⇧Y` on a Mac), which fills straight away and
shows the number of fields it handled on the toolbar badge.

After a run, every field is listed with what happened to it: **filled**, **already set**, or
**not found**. Nothing is hidden behind a generic success message.

### The confirmation box

The popup asks for the account number once. "Confirm account number" is filled from the same
value, so the two can never disagree.

### Other fields

Any label the built-in fields do not cover can be added under **Other fields**: type the label
as it appears on the page and the value to put in it.

## What it will not do

- **It never submits the form.** It fills fields and stops, so you can check the numbers before
  paying.
- **It never clicks a link.** The Terms of Use checkbox is ticked by clicking the checkbox
  itself, never its label, which on most checkouts wraps a link to the terms.
- **It will not guess at a switch it cannot read.** If a toggle exposes no state — no
  `aria-checked`, no underlying checkbox — a click is as likely to turn autopay off as on, so
  it is left alone and reported instead.
- **It cannot reach a hosted card widget.** Fields inside a cross-origin iframe (a Stripe or
  Adyen card field, for instance) belong to another site and are off limits to any extension.
  Those are reported as not found rather than silently skipped.

## Where the data lives

Details are stored with `chrome.storage.local`, on this machine, in this browser profile.
`chrome.storage.sync` is deliberately not used: it mirrors data through a Google account, which
is the wrong place for a bank account number. Nothing is sent anywhere — the extension has no
network code at all. **Erase saved details** in the footer clears everything.

The account and routing numbers are masked in the panel until you press **Show**.

### Permissions

`activeTab`, `scripting`, and `storage` — and no host permissions, so the extension has no
standing access to any site. It can only read or change a page in the moment you ask it to, by
clicking the icon or pressing the shortcut. That is also why there is no fill-on-page-load
option: it would require permission to watch every page you visit.

## How fields are matched

Payment forms are built by bundlers, so `name` and `id` are usually hashed noise
(`name="f_9c4"`). Matching therefore works off what you can actually see — the label text —
gathered from `<label for>`, a wrapping `<label>`, `aria-label`, `aria-labelledby`,
placeholder, and the nearest preceding text, with the search stopping at the next form control
so a field can never steal its neighbour's label.

Each field carries required and rejected keywords, matched on whole words. "Account number"
rejects *confirm*, *routing*, and *card*; "Confirm account number" requires one of *confirm*,
*re-enter*, *verify*, or *repeat*. Every field/control pair is then scored and the strongest
pairs claim their control first, so the account number cannot land in the confirmation box just
because it was scanned first. Anything scoring below the threshold is left alone and reported
as not found — a wrong value in a bank field is far worse than a blank one.

Two more things checkout forms do that break naive fillers, both handled:

- **React-controlled inputs.** React installs its own `value` setter and caches the last value.
  A plain `el.value = x` updates the DOM but never reaches component state, so the field blanks
  on the next render and submits empty. The engine writes through the prototype setter and
  desyncs React's value tracker so the change is seen as real.
- **Custom dropdowns.** If the control is not a `<select>`, it is opened, the options are waited
  for, and the matching one is clicked. Only options that appear *in response to* that click are
  considered — a site nav is full of `role="menuitem"` elements and one of them can easily read
  "Company", and clicking it would navigate away from a half-filled form.

Every write is verified afterwards. If the value did not stick, the engine retries by
simulating keystrokes for masked inputs, and if it still did not stick it reports a failure
rather than claiming success.

## Development

The engine is covered by the repository's check harness:

```bash
npx tsx scripts/autofill-check.ts
```

It runs the engine against a jsdom replica of the payment form and the failure modes that
matter: React-controlled inputs, confirm/account disambiguation, decoy fields that must be left
untouched, custom dropdowns, and honest reporting when a field refuses a value.

Icons are generated, not hand-drawn:

```bash
node extension/icons/make-icons.mjs
```

### Layout

| Path | What it is |
|------|-----------|
| `manifest.json` | MV3 manifest |
| `src/inject/fill-engine.js` | Injected into the page; all matching and filling logic |
| `src/lib/fill-runner.js` | Injects the engine and merges the per-frame reports |
| `src/lib/fields.js` | The editable shape of a profile, shared by popup and worker |
| `src/lib/storage.js` | Profile persistence |
| `src/background.js` | Service worker: runs fills, handles the shortcut, sets the badge |
| `src/popup/` | The panel |

The engine is a classic script rather than a module because `chrome.scripting.executeScript`
injects files as classic scripts.
