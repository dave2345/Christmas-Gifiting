# Merry Match

A cozy, private Christmas gift exchange matcher. Add the people taking part, let each participant choose an available mystery recipient, and keep the complete list of gift matches behind a PIN.

## Features

- Add and remove participants from the gift list.
- Let participants choose a recipient without assigning themselves or reusing someone already chosen.
- Keep each participant's chosen recipient hidden from the general name list.
- Set a PIN to view the complete list of matches.
- Save participants, matches, and the results PIN in a local SQLite database.

## Requirements

- [Node.js](https://nodejs.org/) 22.5.0 or newer (the application uses Node's built-in `node:sqlite` module).
- npm, included with Node.js.

## Setup

1. Clone the repository and open a terminal in the project directory.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Start the development server:

   ```sh
   npm run dev
   ```

4. Open the local URL printed by Vite, usually `http://localhost:5173`.

The first time the app starts, it creates its SQLite database at `data/merry-match.sqlite`. The `data/` directory is local application data and is not included in Git.

## Using the app

1. Open **Name list** and add everyone taking part.
2. Each participant opens **Find your match**, enters their name, and chooses one of the available recipients.
3. To view the complete assignment list, open **The matches** and set a PIN when prompted. Use that PIN to unlock the results later.

The reset flow for the results PIN requires the phrase `devreset`.

## Development

Run the API tests:

```sh
npm test
```

Create a production build:

```sh
npm run build
```

Preview the production build locally:

```sh
npm run preview
```

The API is served by Vite middleware in development and preview; no separate API server command is needed.
