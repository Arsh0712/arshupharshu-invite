# Discord invite tracker bot

An discord bot which can track invites accurately, built with discord.js v14 and uses components V2.

---

# Features

Invite tracking, leaderboard, rejoin and leave tracking, vanity URL detection, event logging, admin invite management, owner-only guild panel, cooldown system, and a click-to-check invite panel embed.

---

# Commands

## user commands

### `/invites`

Shows how many invites a user has. Leave the user option empty to check your own. Shows current count, how many people joined through them, how many left, and how many rejoined.

---

### `/inviter`

Shows who invited a specific member, whether they've left, and if they've rejoined.

---

### `/invitebreakdown`

A more detailed look at a user's invites — total, valid, leaves, rejoins, and fake invites.

---

### `/inviteleaderboard`

Shows the top 10 inviters in the server with their full stats.

---

### `/vanitycheck`

Checks if the server has a vanity URL and shows it if it does.

---

### `/ping`

Shows the bot's current latency.

---

## admin commands

These require administrator permission.

### `/invitelogs`

Sets a channel where the bot logs every invite event — joins, leaves, and rejoins.

```
/invitelogs channel:#invite-logs
```

---

### `/resetallinvites`

Wipes all invite data for the server. Asks for confirmation before doing anything since it can't be undone.

---

### `/resetinvites`

Resets invite data for a specific user.

---

### `/addinvites`

Manually adds invites to a user's count.

```
/addinvites user:@User amount:5
```

---

### `/removeinvites`

Manually removes invites from a user's count.

```
/removeinvites user:@User amount:3
```

---

### `/exportinvites`

Exports all invite data for the server as a CSV, shown directly in Discord.

---

### `/invitespanel`

Sends an embed to a channel with a button members can click to check their own invite count.

---

## owner commands

Locked to whoever is listed in `BOT_OWNER_IDS` in your `.env` file.

### `/botguilds`

Shows every server the bot is in with member counts and invite links.

---

# invite logging

Once you set a log channel with `/invitelogs`, the bot posts an embed every time someone joins, leaves, or rejoins, showing who invited them. Vanity URL joins are also logged.

```
member joined
ExampleUser joined
invited by: @User
```

---

# how invite tracking works

The bot works around this by caching all active invites on startup, then comparing use counts when someone joins to figure out which invite went up.

---

# data storage

All data is kept in two local JSON files. `invitedata.json` stores invite counts, join/leave history, who invited who, and log channel settings. `guild_invites.json` stores cached invite links for the `/botguilds` command. Data saves automatically every 5 minutes and on clean shutdown.

---

# installation

**1. install dependencies**

```
npm install discord.js dotenv
```

**2. set up your .env file**

Create a `.env` file in the same folder as `index.js`:

```env
TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
BOT_OWNER_IDS=your_user_id_here
```

For multiple bot owners, separate IDs with commas:

```env
BOT_OWNER_IDS=123456789012345678,987654321098765432
```

A `.env.example` is included as a template.

**3. enable intents**

In the [Discord developer portal](https://discord.com/developers/applications), go to your bot and enable server members intent and message content intent. Guild invites doesn't need to be toggled.

**4. run it**

```
node index.js
```

---

# required permissions

The bot needs view channels, send messages, embed links, read message history, manage server, and create instant invite.

---

# project structure

```
invite-tracker/
├── index.js
├── .env
├── .env.example
├── invitedata.json
├── guild_invites.json
└── package.json
```

---

# notes

Never commit your `.env` file — add it to `.gitignore`. The `.env.example` is safe to push since it has no real values. Invite counts can't go below 0. The `/resetallinvites` command requires confirmation so you can't accidentally wipe everything.

---

# license

MIT license — Copyright (c) 2026 zMachine-0

---
