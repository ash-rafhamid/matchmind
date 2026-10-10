# MatchMind - submission text

Copy-paste ready for the Innovation Studio project page. Links to fill in when submitting: the video URL.

---

## Project name

MatchMind

## Tagline (one line)

An AI match crew that watches every touch, calls it live, explains why it happened - for every fan, in their language - and proves every fact before it reaches the screen.

## Short description (for the project card)

MatchMind turns synthetic match data into a trustworthy broadcast: a 3D stadium, a live neural-voice commentator, and a Microsoft Agent Framework crew on Foundry that explains every key moment for five audiences in ten languages. A deterministic fact-checker verifies every number, name and score before anyone sees it.

## Full description

**The problem.** A studio or streaming service wants instant, personal insight for every viewer: why that goal happened, explained differently for a casual fan, an analyst, a child or a blind viewer, in their own language, the moment it happens. Generative AI can write all of that - but it also invents numbers and players. In sport, one wrong score ruins trust.

**What MatchMind does.**
- **A synthetic match engine.** A calibrated simulator plays full 90-minute matches in a fictional six-club league (shots, xG, passing, fouls and cards match real top-flight averages), and a choreographer turns the events into 10 Hz tracking: players dribble, press, slide in, restart set pieces and celebrate goals.
- **A broadcast you can watch.** A three.js stadium with an AI director that cuts between TV, follow, tactical and goal cameras, slow-motion replays of goals and fouls, and a live commentator voiced by Azure AI Speech ("Okafor shoots... saved by Osei!") in the viewer's language.
- **An AI crew that explains why.** For every key moment, a Microsoft Agent Framework workflow runs an Analyst and a Tactician in parallel, a Storyteller writes for the chosen audience (fan, analyst, child, coach or audio description) in one of 10 languages, and a deterministic Fact-checker checks every number, minute, scoreline, formation and player name against the facts. Rejected drafts go back with the exact problems; if they fail again, the viewer gets a verified template. Nothing unverified reaches the screen.
- **Ask and What-if.** A Host agent answers any question using 9 match-data tools exposed through an MCP server, and a What-if Lab re-simulates the rest of the match 400 times to show how a tactical change would have moved the win chance - with a 95% interval and an honest "no clear effect" when there isn't one.
- **Studio-ready.** Lower thirds for a studio overlay, full-time reports with social posts, a downloadable dataset, and a Scenario Lab that simulates a brand-new match in about ten seconds.

**Agentic design.** Fan-out/fan-in workflow with a revision loop, agent-as-tool, MCP tool use, and a full trace of every step ("How the crew did it") so viewers and producers can see which agent said what, which tools were called, and what the fact-checker rejected.

**Why it matters.** The same verified moment reaches every viewer in their language and at their level - including children and blind or low-vision fans - without a human writing each version, and without the risk of a confident wrong fact on air.

**Built on Microsoft.** Microsoft Foundry (gpt-4.1-mini), Microsoft Agent Framework, Azure AI Speech neural voices, Model Context Protocol, Azure Container Apps with a managed identity (no keys or passwords in production), GitHub with CI. Stories for the featured matches are pre-written and verified in every language, so viewing them costs nothing.

All teams, players and matches are synthetic. No real league data, footage or trademarks are used.

## Built with

Microsoft Foundry (gpt-4.1-mini) · Microsoft Agent Framework · Azure AI Speech · Model Context Protocol · Azure Container Apps · Azure Container Registry · Log Analytics · Managed identity · Python · FastAPI · NumPy · React · TypeScript · three.js · GitHub Actions

## Links

- Live demo: https://matchmind.blackisland-4799a434.japaneast.azurecontainerapps.io/
- Code: https://github.com/ash-rafhamid/matchmind (make it public before submitting)
- MCP endpoint: https://matchmind.blackisland-4799a434.japaneast.azurecontainerapps.io/mcp/
- Video: (add the YouTube link)

## Category

If the form asks for one bonus category: **Best Use of Microsoft Foundry** (the crew, the model, the voice and the fact-checking all run through one Foundry resource). Strong second choice: **Best Multi-Agent Orchestration** (Agent Framework workflow with fan-out, revision loop, agent-as-tool and MCP).
