// The TUI only highlights the opentui built-ins (markdown, javascript,
// typescript). Remote tree-sitter parser/query downloads were removed on
// purpose: the TUI fetches nothing from the network at render time.
export default {
  parsers: [],
}
