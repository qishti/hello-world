# Folio

An outliner with the look and object model of Capacities. Every note is a typed object made of nested, collapsible bullets, so it works like Logseq without the clutter.

No build step and no dependencies. Data stays in your browser (IndexedDB).

## Run it

```sh
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
js/views.js         daily, object, tasks, calendar, graph, settings
js/integrations.js  Todoist, Readwise, calendar, reminders
js/reader.js        PDF reader
vendor/             PDF.js
js/export.js        Markdown/zip export
js/ics.js           iCalendar parser with recurrence expansion
js/app.js           shell, router, sidebar, command palette
```
