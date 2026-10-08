"""MCP server exposing the match-data tools.

Mounted at /mcp on the web app (streamable HTTP), so the crew - or any MCP
client such as GitHub Copilot agent mode or Foundry agents - can query matches.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .tools import ALL_TOOLS

mcp = FastMCP(
    "MatchMind match data",
    instructions="Tools over synthetic football matches: overview, key moments, team and player stats, event "
                 "search, possession chains, momentum and what-if tactical simulations. Call match_overview first.",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
)

for fn in ALL_TOOLS:
    mcp.add_tool(fn)
