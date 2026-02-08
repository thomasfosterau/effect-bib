# reference-manager

A comprehensive Svelte component library for managing citations, references, footnotes, and notes in academic and technical documents.

## Features

- 📚 **Multiple Citation Styles**: Support for APA, MLA, Chicago, Harvard, IEEE, and Vancouver styles
- 🔗 **Inline Citations**: Easy-to-use citation components with automatic numbering
- 📝 **Bibliography Generation**: Automatically formatted reference lists
- 📌 **Footnotes & Endnotes**: Full support for footnotes and endnotes with back-references
- 💡 **Side Notes**: Marginal notes for supplementary information
- 🎨 **Storybook Integration**: Interactive component documentation and previews
- 📦 **TypeScript Support**: Fully typed for excellent developer experience
- ⚡ **Built with Vite**: Fast development and build times

## Installation

```bash
npm install @thomasfosterau/reference-manager
```

Or with bun:

```bash
bun add @thomasfosterau/reference-manager
```

## Usage

### Basic Example

```svelte
<script>
  import { ReferenceManager, Citation, Bibliography } from '@thomasfosterau/reference-manager';

  const source = {
    id: 'smith2020',
    type: 'article',
    title: 'The Future of Web Development',
    author: 'Smith, J.',
    year: 2020,
    journal: 'Web Development Today',
    volume: '15',
    pages: '45-67'
  };
</script>

<ReferenceManager style="apa">
  <p>
    According to recent research <Citation {source} />, web development is evolving rapidly.
  </p>
  
  <Bibliography title="References" />
</ReferenceManager>
```

### Citation Styles

The library supports multiple citation styles:

- **APA** (American Psychological Association)
- **MLA** (Modern Language Association)
- **Chicago** (Chicago Manual of Style)
- **Harvard** (Harvard referencing)
- **IEEE** (Institute of Electrical and Electronics Engineers)
- **Vancouver** (Vancouver style for biomedical journals)

```svelte
<ReferenceManager style="mla">
  <!-- Your content with citations -->
</ReferenceManager>
```

### Footnotes

```svelte
<script>
  import { FootnoteManager, Footnote, FootnoteList } from '@thomasfosterau/reference-manager';
</script>

<FootnoteManager>
  <p>
    This is a paragraph with a footnote<Footnote content="This is the footnote text." />.
  </p>
  
  <FootnoteList title="Footnotes" />
</FootnoteManager>
```

### Endnotes

```svelte
<script>
  import { FootnoteManager, EndNote, EndNoteList } from '@thomasfosterau/reference-manager';
</script>

<FootnoteManager>
  <p>
    This is a paragraph with an endnote<EndNote content="This is the endnote text." />.
  </p>
  
  <EndNoteList title="Endnotes" />
</FootnoteManager>
```

### Side Notes

```svelte
<script>
  import { SideNote } from '@thomasfosterau/reference-manager';
</script>

<p>
  This paragraph has a side note
  <SideNote content="This appears in the margin" position="right" />
  that provides additional context.
</p>
```

## Source Types

The library supports various source types:

- `article` - Journal articles
- `book` - Books
- `website` - Web pages
- `report` - Technical reports
- `conference` - Conference proceedings
- `thesis` - Theses and dissertations
- `misc` - Miscellaneous sources

## API Reference

### Components

#### `<ReferenceManager>`

The main context provider for citations and references.

**Props:**
- `style`: CitationStyle - The citation style to use (default: 'apa')

#### `<Citation>`

Renders an inline citation.

**Props:**
- `source`: Source (optional) - The source object to cite
- `sourceId`: string (optional) - The ID of a previously added source
- `page`: number (optional) - Page number for the citation

#### `<Bibliography>`

Renders the bibliography/reference list.

**Props:**
- `title`: string - Title for the bibliography section (default: 'References')
- `numbered`: boolean - Whether to use numbered list (default: false)

#### `<FootnoteManager>`

Context provider for footnotes and endnotes.

#### `<Footnote>`

Renders a footnote reference.

**Props:**
- `id`: string (optional) - Unique identifier for the footnote
- `content`: string - The footnote text

#### `<FootnoteList>`

Renders the list of footnotes.

**Props:**
- `title`: string - Title for the footnotes section (default: 'Footnotes')

#### `<EndNote>`

Renders an endnote reference (uses same system as footnotes).

**Props:**
- `id`: string (optional) - Unique identifier for the endnote
- `content`: string - The endnote text

#### `<EndNoteList>`

Renders the list of endnotes.

**Props:**
- `title`: string - Title for the endnotes section (default: 'Endnotes')

#### `<SideNote>`

Renders a marginal note.

**Props:**
- `content`: string - The note text
- `position`: 'left' | 'right' - Position of the note (default: 'right')

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start Storybook
npm run storybook

# Build the library
npm run package

# Check types
npm run check
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © Thomas Foster

## Acknowledgments

Built with:
- [Svelte](https://svelte.dev/)
- [SvelteKit](https://kit.svelte.dev/)
- [Vite](https://vitejs.dev/)
- [Storybook](https://storybook.js.org/)
- [Changesets](https://github.com/changesets/changesets)
