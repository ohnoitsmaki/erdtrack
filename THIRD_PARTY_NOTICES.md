# Third-party notices

What Erdtrack ships that others made, and under what licence.

## EROverlay boss list

`convex/eroverlayBosses.json` is `src/boss/data/engus/bosses.json` from
[soarqin/EROverlay](https://github.com/soarqin/EROverlay), copied unchanged
at commit `5fd0139356c0ba4823c7005b7b7e8e8316ac84ce`.

```
MIT License

Copyright (c) 2023-2025 Soar Qin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Boss Defeat Flag positions

`src-tauri/data/defeat_flag_blocks.txt` holds where the 180 blocks of event
flags that hold the bosses' Defeat Flags sit in a save. The positions are
taken from `src/res/eventflag_bst.txt` in ClayAmore's
[ER-Save-Lib](https://github.com/ClayAmore/ER-Save-Lib), at commit
`d54d9282527dfa55a6adea6b0b3d77564aff726b`, as facts about the game's layout.
They are about 1.5% of that table, chosen and arranged by us. ER-Save-Lib has
no licence, so only these facts are taken, never its code or the whole table.

## ER-Save-Editor flag offsets

`src-tauri/data/er_save_editor_flags.txt` is used only by a test that checks
the positions above, and isn't shipped. It holds 135 flag offsets copied from
`src/db/event_flags.rs` in ClayAmore's
[ER-Save-Editor](https://github.com/ClayAmore/ER-Save-Editor), at commit
`014107f0ca1cff867b5f7565cb79d6684f9b35df`. ER-Save-Editor is dual-licensed
under Apache-2.0 and MIT; these offsets are used under its MIT licence.

```
MIT License

Copyright (c) 2024 ClayAmore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled fonts

The Panel bundles Cinzel, Inter and Bebas Neue for the Overlay, and Geist and
Geist Mono for its own screens. Each comes from
its Fontsource package (version 5.3.0), unchanged, and is under the SIL Open
Font License 1.1, whose full text follows the copyright lines.

- Geist (`@fontsource-variable/geist`): Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
- Geist Mono (`@fontsource-variable/geist-mono`): Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
- Cinzel (`@fontsource-variable/cinzel`): Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel)
- Inter (`@fontsource-variable/inter`): Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- Bebas Neue (`@fontsource/bebas-neue`): Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Libraries in the Panel and the App

The Panel and the Overlay page contain these open-source libraries, and the
libraries they depend on, each under its own licence:

- React and React DOM (MIT), and Convex's client (Apache-2.0).
- The Panel's screens: the `ui/` design system's Base UI, Tabler Icons, cn,
  tw-animate-css, Tailwind CSS and shadcn's stylesheet (all MIT), and
  class-variance-authority (Apache-2.0).

`erdtrack.exe` contains these, and the libraries they depend on:

- The App's window: React and React DOM, the `ui/` design system as above,
  Geist (see Bundled fonts), and the Tauri JavaScript API (MIT or
  Apache-2.0).
- The Rust side: Tauri (MIT or Apache-2.0), rfd (MIT), md5 (MIT or
  Apache-2.0), serde and serde_json (MIT or Apache-2.0), and windows-sys
  (MIT or Apache-2.0).

The exact versions are pinned in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`.
