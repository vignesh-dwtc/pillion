#!/usr/bin/env bash
# Print a web page as readable plain text (for subagents that have Bash but no WebFetch).
# usage: scripts/fetch-doc.sh <url> [max-chars]
# Works through the cloud session's HTTPS proxy (curl honours HTTPS_PROXY and the CA bundle).
# Never pass project or personal details in URLs or query strings.
set -euo pipefail
url="${1:?usage: fetch-doc.sh <url> [max-chars]}"
max="${2:-60000}"
curl -fsSL --max-time 60 -A 'Mozilla/5.0 (doc-fetch)' "$url" | python3 -I -c '
import sys, html, re
from html.parser import HTMLParser

class T(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "pre", "section", "article", "table"}
    def __init__(self):
        super().__init__(); self.out = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        if tag in self.BLOCK: self.out.append("\n")
        if tag in ("h1", "h2", "h3", "h4"): self.out.append("\n## ")
        if tag == "li": self.out.append("- ")
    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip: self.skip -= 1
        if tag in self.BLOCK: self.out.append("\n")
    def handle_data(self, data):
        if not self.skip: self.out.append(data)

p = T(); p.feed(sys.stdin.read())
text = html.unescape("".join(p.out))
text = re.sub(r"[ \t]+\n", "\n", text); text = re.sub(r"\n{3,}", "\n\n", text)
sys.stdout.write(text.strip()[: int(sys.argv[1])] + "\n")
' "$max"
