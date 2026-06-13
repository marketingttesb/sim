# SIM - AI Agent Simulator and Environment Installer

## Installation (PC Baru)

**Requirements:** Node.js (18+), Git

 `powershell
# 1. Clone
git clone https://github.com/marketingttesb/sim.git D:\Dev\sim
cd D:\Dev\sim

# 2. Install semua (npm prefix, MCP memory, skills, config, junction)
npm run setup
# atau:
npm install    # auto-run setup via postinstall

# 3. Guna
opencode
 `

Apa installer buat:
- Set npm prefix ke D:\Apps
- Install MCP memory server ke D:\Apps\OpenCode\mcp-memory\
- Install skills ke D:\Apps\OpenCode\skills\
- Setup config di C:\Users\<user>\.config\opencode\opencode.jsonc
- Junction skills ke C:\Users\<user>\.config\opencode\skills -> D:\Apps\OpenCode\skills

Memory files auto-tercipta bila guna. Start fresh setiap PC.