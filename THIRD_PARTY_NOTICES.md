# Hyperresearch

This port adapts the light-pipeline workflow and scholarly-provider field mappings from
https://github.com/jordan-gibbs/hyperresearch at
`75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c` (0.11.1).
The temporary Python backend is pinned to that commit. OpenAlex/Crossref field
handling in `src/scholarly-providers.ts` adapts the upstream providers behind a
new normalized TypeScript contract. Pi integration and dashboard are
separate implementations; this is not a claim of upstream feature or benchmark parity.

MIT License

Copyright (c) 2026 Jordan Gibbs

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
