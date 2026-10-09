# Chess engine binaries

Provenance-verified copies of the Stockfish WebAssembly build used for the
real-time evaluation chart. Verified on 2026-10-09 against the official
`stockfish.js@10.0.2` npm package (Stockfish 10, ddugovic multi-variant,
compiled by Niklas Fiekas, <https://github.com/lichess-org/stockfish.js>).

| File               | SHA256                                                            | Note                                              |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------- |
| `stockfish.wasm`   | `45816b436eb8c180acb2c5b9fda0148101f411edbfa6bf919918e0a362eafca8` | byte-identical to the npm package                 |
| `stockfish.wasm.js`| `632e59bfd48adb2b1cba8757f9195e582aa9684425f3ec5b9d4c1bd05ff0afdb` | npm package file minus one trailing newline (as bundled by the [react-chessboard demo](https://github.com/Clariity/react-chessboard/tree/main/docs/stockfish) this project originally copied it from) |

Only `stockfish.wasm.js` (which loads `stockfish.wasm`) is referenced by the
app (`src/app/_components/evaluation.tsx`).

Verify locally with:

```bash
shasum -a 256 stockfish.wasm stockfish.wasm.js
```

## License

Stockfish and its WebAssembly builds are distributed under the GNU General
Public License v3 — see `COPYING.txt` (taken from the official package). If
you redistribute this project, keep the engine files and this license notice
together, and be aware of GPL obligations for derived works.

## Upgrading

If you replace these binaries with a newer Stockfish build, re-verify the
hashes against the official release you download from, update the table
above, and re-test the evaluation chart — the app parses the engine's
`Total evaluation:` output format, which can change between major versions.
