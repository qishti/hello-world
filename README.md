# Folio

An outliner with the look and object model of Capacities. Every note is a typed object made of nested, collapsible bullets, so it works like Logseq without the clutter.

No build step and no dependencies. Data stays in your browser (IndexedDB).

## Run it

**macOS:** double-click `Folio.command`. It pulls the latest version, installs anything missing, restarts the server and opens the app. Close its Terminal window to stop Folio.

**Or by hand:**

```sh
npm install           # once; only needed for email-in
node server.js        # http://localhost:8787
```

Any static host also works (GitHub Pages, `npx http-server`). `server.js` additionally runs a small CORS proxy for Readwise and calendar feeds, which browsers block. Todoist works without it.

## Features

**Outliner**
- Nested bullets: Enter, Tab / Shift+Tab, Alt+↑/↓ to move, Cmd/Ctrl+↑/↓ to fold, drag handle to reorder.
- `/` menu: text, headings, task, quote, callout, code, due date, reminder, date link, meeting note, send to Todoist.
- Markdown shortcuts (`# `, `> `, `[] `, ``` ```), `**bold**`, `*italic*`, `==highlight==`, `~~strike~~`, `` `code` ``.
- Pasting indented lists or Markdown becomes a block tree.

**Objects and linking**
- Types: Page, Person, Meeting, Source, Project, Idea, Tag, Daily note. Add your own in Settings.
- `[[` links to or creates any object. `#tags` work too. Renaming an object updates its links.
- Linked references and unlinked mentions (with one-click linking) under every object.
- Properties per type, favorites, quick find and create with Cmd/Ctrl+K, graph view.

**Recent Capacities-style additions**
- Right side panel: outline of headings, backlinks, outgoing links, note info.
- Type views as Gallery, Table, List or Board (drag cards between status columns), with search, sort and tag filter.
- Aliases: other names for an object. Links and backlinks resolve through them.
- Recurring tasks: every day, weekday, week, month or year. Completing advances the due date.
- Version history per object, with preview and restore.
- Presentation mode: top-level bullets become slides.

**Markdown vault (Obsidian-compatible)**
- Settings > Markdown vault: pick a folder (default `~/Documents/Folio Vault`) and every note is written there as its own `.md` file, kept up to date as you type.
- One file per note, grouped by type: `People/Ada Lovelace.md`, `Meetings/Product sync.md`, `Daily notes/2026-10-11.md`. PDFs and images go in `Files/`.
- Properties are YAML front matter (`title`, `type`, `aliases`, `tags`, your properties, object links as `[[Wikilinks]]`). Notes are nested bullets; tasks use `- [ ]` with 📅 ⏰ 🔁 markers; links are `[[Title]]`; tags are `#tag`.
- Open the same folder as an Obsidian vault. Edit there and the changes flow back into Folio within seconds, including new files, renamed files, checkboxes and properties. Folio keeps the previous version in History.
- Safe by design: a note edited in both places keeps both (the other copy is saved as "(conflict …)"); deleting a file does not delete the note, Folio writes it back; only the chosen folder is ever touched.
- Restore on a new computer: connect the same folder and press "Re-read whole folder". Highlights, PDFs, properties and links come back.
- Needs `node server.js` (or `Folio.command`) because browsers cannot write to a folder on their own.

**Database views (Notion and Obsidian Bases style)**
- Every type page is a database. Saved views appear as tabs: Table, Gallery, List or Board, each with its own filters, sort, grouping and column choices. Double-click a tab to rename it.
- Edit cells in place: text, numbers, dates, checkboxes, labels (with "New option…") and object links. Add rows with **New**, and rows inherit the group or filter you are in.
- Add a property from the **+** in the table header. Header menus let you sort, hide, rename, change the property type, edit label options or delete it.
- Filter with conditions per property, group by any label, checkbox, object or text property, and show, hide and reorder columns from **Properties**.
- Daily notes have a **Reviewed** checkbox, a "To review" view, review marks in both calendars, and a nudge when yesterday was not reviewed.
- Highlights offer Cards, List, Table and Board by color, with sorting and grouping by source, color or tag. Drag a card to another column to recolor it.

**Types and properties (modeled on a Capacities space)**
- Edit any type (name, icon, color) or create new ones from the sidebar `+`, Settings, an object's type pill, or a type page.
- Property kinds: Text, Long text, Number, Date (single day or a range), Label (single choice with your own options), Checkbox, Link, and **Object**.
- **Object properties** link to other types, for example Meeting → Attendees (People), Person → Organization, Project → Collaborators. Pick existing objects or create one on the spot. Linked objects show backlinks "as Attendees", and the links appear in the graph.
- Built-in types follow Capacities' defaults: Page, Person, Organization, Meeting, Project, plus Source, PDF, Idea and Tag. Existing data is upgraded in place.
- Calendar meeting notes now fill the Attendees property with Person objects, matched by email.
- Graph: color-coded by type, with type filters, daily notes and unlinked toggles, search, property links drawn solid and text links dashed, and a local graph (depth 1 to 3) for any object via its panel or by double-clicking a node.
- Table and Board views understand all property kinds; Board can group by any Label property.

**Email in**
- Email or forward items to yourself. Each one lands in that day's daily note as a bullet tagged `#email`, with the body as child bullets. Quoted replies and signatures are trimmed, links and attachment names are listed.
- A subject starting with `todo:` becomes a task due that day.
- The tag page `#email` collects everything you have emailed in.
- How it works: `node server.js` checks an IMAP folder or label every 2 minutes and holds new mail until Folio picks it up, so mail is not lost while the browser is closed. Gmail setup is in Settings > Email in: turn on IMAP, make an app password, create a label `Folio`, and filter mail to `you+folio@gmail.com` into it.
- Your app password is stored only in `.folio-mail.json` on your computer. The server listens on localhost only. Attachments are not imported.

**Readwise highlights, Heptabase style**
- Highlights library: every highlight from Readwise and your PDFs in one place, grouped by source, with search and filters for source, color, tag and origin.
- Drawer: open it from the toolbar while writing. Drag a highlight into any note, or press Add. It stays linked to its source and updates if you edit it there.
- Background sync on open and every 10 minutes, with a toast for new highlights. Manual mode is in Settings.
- Your edits win: highlights you edit, annotate or embed are never overwritten or removed by a later sync. Unedited ones follow Readwise, including deletions.
- Readwise color and tags come across; notes become child bullets.

**Drag and drop import**
- Drop files anywhere in Folio, or onto the drop zone at the top of the PDFs page. Several at once is fine.
- PDFs open in the reader and get a first-page thumbnail. The same file is never imported twice.
- Word (.docx), Markdown and text files become pages with headings, nested bullets, tasks and quotes. Images become image bullets.
- If a note is open when you drop, links to the new pages (or the images themselves) are added to it.
- Also available from the sidebar `+`, the command palette, and the PDFs page. Everything exports back out under `Files/`.

**PDF reader**
- Import a PDF from the sidebar `+`, the command palette, the PDFs page, or by dropping a file anywhere.
- Page-by-page reader with zoom, arrow-key paging and your place remembered.
- Select text and pick a color to highlight. Each highlight becomes a quote bullet with its page number; add a note as a child bullet. Deleting the bullet removes the highlight.
- Snapshot tool: drag over any area to save it as an image bullet.
- Analyze: page and word counts, top keywords and an extractive summary, computed on your device (no AI service).
- Markdown export includes the original PDF and snapshot images under `Files/`.
- Built on [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), vendored in `vendor/`.

**Daily notes and calendar**
- Daily note per date with an agenda card, tasks due today, and a highlight from your reading.
- Month calendar and a mini calendar in the sidebar.
- Calendar feeds: paste a Google Calendar "secret address in iCal format" or any `.ics` URL, or import a file. Recurring events and time zones are handled.

**Meeting notes**
- One click on an event creates a Meeting object with a template (Agenda, Notes, Action items). Attendees become linked Person objects.

**Tasks and reminders**
- Any bullet becomes a task with Cmd/Ctrl+Enter. Due dates and reminders from the `/` menu.
- Tasks view: Overdue, Today, Upcoming, No date, Completed, Reminders. Quick add at the top.
- Reminders fire an in-app toast and a browser notification, with snooze.

**Integrations**
- **Todoist**: API token in Settings. Open tasks appear in Tasks and on the daily note. Send any bullet to Todoist. Completing on either side syncs.
- **Readwise**: access token in Settings. Books, articles and highlights import as Source objects with each highlight as a quote bullet and notes as children. Re-import adds only new highlights.
- **Calendar**: ICS feeds as above.

## Shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+K | Search, create, commands |
| Cmd/Ctrl+\\ | Toggle sidebar |
| Cmd/Ctrl+Enter | Cycle task: none, todo, done |
| Cmd/Ctrl+B / I | Bold / italic |
| Cmd/Ctrl+K in a bullet with text selected | Link selection as `[[object]]` |
| Esc | Leave editing |

## Data

Settings has **Download all as Markdown (.zip)**: one `.md` per object with YAML front matter, grouped by type, plus `Tasks.md`, `Calendar.md` and `Types.md`. A single-file `.md` and a JSON backup (with import) are also there. Each object's `...` menu downloads or copies its own `.md`. Tokens are stored in the browser and are left out of the JSON export. Block-level undo is the browser's per-bullet undo; structural edits have no undo yet.

## Layout

```
index.html  styles.css  server.js
js/store.js         data model, search, backlinks, persistence
js/outline.js       block editor
js/views.js         daily, object, tasks, calendar, graph, highlights, settings
js/database.js      table, gallery, list and board views with filters and saved views
js/integrations.js  Todoist, Readwise, calendar, reminders
js/reader.js        PDF reader
js/importer.js      drag-and-drop import (PDF, docx, md, text, images)
vendor/             PDF.js
js/export.js        Markdown/zip export
mail.js             email-in (IMAP) for the local server
vault.js            Markdown vault writer for the local server
js/vault.js         vault sync client; js/vaultmd.js note format
js/ics.js           iCalendar parser with recurrence expansion
js/app.js           shell, router, sidebar, command palette
```
