const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');
const fs = require('fs');
require('dotenv').config();

// config
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const BOT_OWNER_IDS = process.env.BOT_OWNER_IDS ? process.env.BOT_OWNER_IDS.split(',') : [];

if (!TOKEN) {
    console.error('ERROR: TOKEN is missing from your .env file.');
    process.exit(1);
}
if (!CLIENT_ID) {
    console.error('ERROR: CLIENT_ID is missing from your .env file.');
    process.exit(1);
}
if (!BOT_OWNER_IDS.length) {
    console.warn('WARNING: BOT_OWNER_IDS is empty. Owner-only commands will be unavailable.');
}

const EMBED_COLOR = 0x8AF2E2;
const DATA_FILE = './invitedata.json';
const GUILD_INVITES_FILE = './guild_invites.json';

const log = (...args) => console.log('[BOT]', ...args);
const err = (...args) => console.error('[BOT]', ...args);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    sweepers: {
        messages: { interval: 3600, lifetime: 1800 }
    }
});

const cache = new Map();
const counts = new Map();
const inviters = new Map();
const history = new Map();
const leaves = new Map();
const logChannels = new Map();
const cooldowns = new Map();

let saveTimer = null;

const getData = (map, guildId) => {
    if (map.has(guildId)) return map.get(guildId);
    map.set(guildId, new Map());
    return map.get(guildId);
};

const getCount = (guildId, userId) => {
    return getData(counts, guildId).get(userId) || 0;
};

const inc = (guildId, userId) => {
    getData(counts, guildId).set(userId, getCount(guildId, userId) + 1);
};

const dec = (guildId, userId) => {
    getData(counts, guildId).set(userId, Math.max(0, getCount(guildId, userId) - 1));
};

const loadData = () => {
    try {
        if (!fs.existsSync(DATA_FILE)) return;

        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

        for (const [gId, d] of Object.entries(data)) {
            if (d.c) {
                for (const [uId, cnt] of Object.entries(d.c)) {
                    getData(counts, gId).set(uId, cnt);
                }
            }
            if (d.h) {
                for (const [uId, h] of Object.entries(d.h)) {
                    getData(history, gId).set(uId, {
                        inviterId: h[0],
                        left: h[1],
                        rejoinCount: h[2],
                        isVanity: h[3]
                    });
                }
            }
            if (d.l) {
                for (const [uId, cnt] of Object.entries(d.l)) {
                    getData(leaves, gId).set(uId, cnt);
                }
            }
            if (d.lg) {
                logChannels.set(gId, d.lg);
            }
        }

        log('Data loaded');
    } catch (e) {
        err('Failed to load data:', e.message);
    }
};

const saveData = async () => {
    try {
        const data = {};

        for (const [gId, m] of counts) {
            if (!data[gId]) data[gId] = {};
            data[gId].c = Object.fromEntries(m);
        }

        for (const [gId, m] of history) {
            if (!data[gId]) data[gId] = {};
            data[gId].h = {};
            for (const [uId, h] of m) {
                data[gId].h[uId] = [h.inviterId, h.left, h.rejoinCount, h.isVanity];
            }
        }

        for (const [gId, m] of leaves) {
            if (!data[gId]) data[gId] = {};
            data[gId].l = Object.fromEntries(m);
        }

        for (const [gId, chId] of logChannels) {
            if (!data[gId]) data[gId] = {};
            data[gId].lg = chId;
        }

        const json = JSON.stringify(data);
        await fs.promises.writeFile(DATA_FILE + '.tmp', json);
        await fs.promises.rename(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) {
        err('Failed to save data:', e.message);
    }
};

const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveData, 2000);
};

setInterval(saveData, 300000);

const loadGuildInvites = async () => {
    try {
        if (fs.existsSync(GUILD_INVITES_FILE)) {
            const raw = await fs.promises.readFile(GUILD_INVITES_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        err('Failed to load guild invites:', e.message);
    }
    return {};
};

const saveGuildInvite = async (guildId, inviteUrl) => {
    try {
        const invites = await loadGuildInvites();
        invites[guildId] = {
            url: inviteUrl,
            cached: Date.now()
        };
        const json = JSON.stringify(invites, null, 2);
        await fs.promises.writeFile(GUILD_INVITES_FILE + '.tmp', json);
        await fs.promises.rename(GUILD_INVITES_FILE + '.tmp', GUILD_INVITES_FILE);
        return true;
    } catch (e) {
        err('Failed to save guild invite:', e.message);
        return false;
    }
};

const getGuildInvite = async (guildId) => {
    const invites = await loadGuildInvites();
    return invites[guildId] || null;
};

const removeGuildInvite = async (guildId) => {
    try {
        const invites = await loadGuildInvites();
        if (invites[guildId]) {
            delete invites[guildId];
            const json = JSON.stringify(invites, null, 2);
            await fs.promises.writeFile(GUILD_INVITES_FILE + '.tmp', json);
            await fs.promises.rename(GUILD_INVITES_FILE + '.tmp', GUILD_INVITES_FILE);
            return true;
        }
        return false;
    } catch (e) {
        err('Failed to remove guild invite:', e.message);
        return false;
    }
};

const cacheInvites = async (guild) => {
    try {
        const invites = await guild.invites.fetch();
        const m = new Map();
        invites.forEach(i => {
            m.set(i.code, {
                uses: i.uses || 0,
                inviterId: i.inviter?.id
            });
        });
        cache.set(guild.id, m);
    } catch (e) {
        err(`Failed to cache invites for guild ${guild.id}:`, e.message);
    }
};

const findUsed = async (guild) => {
    try {
        const newInvites = await guild.invites.fetch();
        const cached = cache.get(guild.id) || new Map();

        for (const [code, inv] of newInvites) {
            const c = cached.get(code);
            const uses = inv.uses || 0;
            if (c && uses > c.uses) {
                c.uses = uses;
                return {
                    inviterId: inv.inviter?.id,
                    isVanity: inv.code === guild.vanityURLCode
                };
            }
        }

        newInvites.forEach(i => {
            if (cached.has(i.code)) {
                cached.get(i.code).uses = i.uses || 0;
            }
        });

        return null;
    } catch (e) {
        err(`Failed to find used invite in guild ${guild.id}:`, e.message);
        return null;
    }
};

const logEvent = (guild, embed) => {
    const channelId = logChannels.get(guild.id);
    if (!channelId) return;
    guild.channels.fetch(channelId)
        .then(ch => ch?.send({ embeds: [embed] }))
        .catch(e => err(`Failed to send log event in guild ${guild.id}:`, e.message));
};

const commands = [
    new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Shows invite count for a user')
        .addUserOption(o => o
            .setName('user')
            .setDescription('The user to check (leave empty for yourself)')
        ),
    new SlashCommandBuilder()
        .setName('inviter')
        .setDescription('Shows who invited a specific member')
        .addUserOption(o => o
            .setName('member')
            .setDescription('The member to check')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription("Shows the bot's latency"),
    new SlashCommandBuilder()
        .setName('invitebreakdown')
        .setDescription('Shows detailed breakdown of invites')
        .addUserOption(o => o
            .setName('user')
            .setDescription('The user to check (leave empty for yourself)')
        ),
    new SlashCommandBuilder()
        .setName('vanitycheck')
        .setDescription('Check if server has a vanity URL'),
    new SlashCommandBuilder()
        .setName('inviteleaderboard')
        .setDescription('Shows top inviters in the server'),
    new SlashCommandBuilder()
        .setName('botguilds')
        .setDescription('Shows all guilds the bot is in (Owner only)'),
    new SlashCommandBuilder()
        .setName('invitelogs')
        .setDescription('Set channel for invite event logs')
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('The channel to log events')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('resetallinvites')
        .setDescription('Reset ALL invite data for the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('exportinvites')
        .setDescription('Export all invite data')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('resetinvites')
        .setDescription('Reset all invite data for a user')
        .addUserOption(o => o
            .setName('user')
            .setDescription('The user to reset invites for')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('addinvites')
        .setDescription('Add invites to a user')
        .addUserOption(o => o
            .setName('user')
            .setDescription('The user to add invites to')
            .setRequired(true)
        )
        .addIntegerOption(o => o
            .setName('amount')
            .setDescription('Number of invites to add')
            .setRequired(true)
            .setMinValue(1)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('removeinvites')
        .setDescription('Remove invites from a user')
        .addUserOption(o => o
            .setName('user')
            .setDescription('The user to remove invites from')
            .setRequired(true)
        )
        .addIntegerOption(o => o
            .setName('amount')
            .setDescription('Number of invites to remove')
            .setRequired(true)
            .setMinValue(1)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('invitespanel')
        .setDescription('Send an invite panel to a channel')
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('The channel to send the panel to')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

new REST({ version: '10' })
    .setToken(TOKEN)
    .put(Routes.applicationCommands(CLIENT_ID), { body: commands })
    .catch(e => err('Failed to register commands:', e.message));

client.once('ready', async () => {
    log(`Logged in as ${client.user.tag}`);
    loadData();
    await Promise.all(client.guilds.cache.map(g => cacheInvites(g)));
    log('Bot ready!');
});

client.on('guildCreate', cacheInvites);

client.on('inviteCreate', i => {
    const c = cache.get(i.guild.id) || new Map();
    c.set(i.code, {
        uses: i.uses || 0,
        inviterId: i.inviter?.id
    });
    cache.set(i.guild.id, c);
});

client.on('inviteDelete', i => {
    cache.get(i.guild.id)?.delete(i.code);
});

client.on('guildMemberAdd', async m => {
    const used = await findUsed(m.guild);

    if (!used?.inviterId && !used?.isVanity) {
        logEvent(m.guild, new EmbedBuilder()
            .setTitle('Member Joined')
            .setDescription(`${m.user.tag} joined\n**Inviter:** Unknown`)
            .setColor(EMBED_COLOR)
            .setTimestamp()
        );
        return;
    }

    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    const lv = getData(leaves, m.guild.id);

    let isRejoin = false;

    if (h.has(m.id)) {
        const d = h.get(m.id);
        if (d.left) {
            d.rejoinCount++;
            d.left = false;
            isRejoin = true;
            lv.set(m.id, (lv.get(m.id) || 0) - 1);
        }
    } else {
        h.set(m.id, {
            inviterId: used.inviterId,
            left: false,
            rejoinCount: 0,
            isVanity: used.isVanity
        });
    }

    if (!used.isVanity) {
        inv.set(m.id, used.inviterId);
        inc(m.guild.id, used.inviterId);
    }

    const inviterText = used.isVanity ? 'Vanity URL' : `<@${used.inviterId}>`;

    logEvent(m.guild, new EmbedBuilder()
        .setTitle(isRejoin ? 'Member Rejoined' : 'Member Joined')
        .setDescription(`${m.user.tag} ${isRejoin ? 'rejoined' : 'joined'}\n**Invited by:** ${inviterText}`)
        .setColor(EMBED_COLOR)
        .setTimestamp()
    );

    queueSave();
});

client.on('guildMemberRemove', m => {
    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    const lv = getData(leaves, m.guild.id);

    if (h.has(m.id)) {
        h.get(m.id).left = true;
    }

    lv.set(m.id, (lv.get(m.id) || 0) + 1);

    const invId = inv.get(m.id);
    let inviterText = 'Unknown';

    if (invId) {
        dec(m.guild.id, invId);
        inv.delete(m.id);
        inviterText = `<@${invId}>`;
    } else if (h.has(m.id) && h.get(m.id).isVanity) {
        inviterText = 'Vanity URL';
    }

    logEvent(m.guild, new EmbedBuilder()
        .setTitle('Member Left')
        .setDescription(`${m.user.tag} left\n**Was invited by:** ${inviterText}`)
        .setColor(EMBED_COLOR)
        .setTimestamp()
    );

    queueSave();
});

client.on('interactionCreate', async i => {
    if (i.isCommand()) {
        const { commandName: cmd, guildId: g, user, options, guild, memberPermissions } = i;
        const isOwner = BOT_OWNER_IDS.includes(user.id);

        if (!isOwner) {
            const now = Date.now();
            const cooldownKey = `${user.id}-${cmd}`;
            const cooldownEnd = cooldowns.get(cooldownKey);

            if (cooldownEnd && now < cooldownEnd) {
                return i.reply({
                    content: `Please wait ${((cooldownEnd - now) / 1000).toFixed(1)}s before using this command again.`,
                    ephemeral: true
                });
            }

            cooldowns.set(cooldownKey, now + 3000);
            setTimeout(() => cooldowns.delete(cooldownKey), 3000);
        }

        const embed = () => new EmbedBuilder().setColor(EMBED_COLOR).setTimestamp();

        if (cmd === 'invites') {
            const u = options.getUser('user') || user;
            const c = getCount(g, u.id);
            const userHistory = Array.from(getData(history, g).values()).filter(h => h.inviterId === u.id);
            const joined = userHistory.length;
            const left = userHistory.filter(h => h.left).length;
            const rejoined = userHistory.reduce((sum, h) => sum + h.rejoinCount, 0);

            return i.reply({
                embeds: [embed()
                    .setTitle('Invites')
                    .setDescription(`${u} currently has **${c}** | ${joined} joined, ${left} left, ${rejoined} rejoined`)
                ]
            });
        }

        if (cmd === 'inviter') {
            const u = options.getUser('member');
            const info = getData(history, g).get(u.id);
            const e = embed().setTitle('Inviter Information');

            if (info?.inviterId) {
                let d = `${u} was invited by <@${info.inviterId}>.`;
                if (info.left) {
                    d += '\n\n**Status:** Left the server';
                } else if (info.rejoinCount > 0) {
                    d += `\n\n**Status:** Rejoined the server (${info.rejoinCount} time${info.rejoinCount !== 1 ? 's' : ''})`;
                }
                e.setDescription(d);
            } else if (info?.isVanity) {
                e.setDescription(`${u} joined via Vanity URL.`);
            } else {
                e.setDescription(`Inviter unknown for ${u}.`);
            }

            return i.reply({ embeds: [e] });
        }

        if (cmd === 'ping') {
            return i.reply({
                embeds: [embed()
                    .setTitle('Pong!')
                    .setDescription(`Latency: **${Math.round(client.ws.ping)}ms**`)
                ]
            });
        }

        if (cmd === 'invitebreakdown') {
            const u = options.getUser('user') || user;
            const total = getCount(g, u.id);
            const userHistory = Array.from(getData(history, g).values()).filter(h => h.inviterId === u.id);
            const leavesCount = userHistory.filter(h => h.left).length;
            const rejoins = userHistory.filter(h => h.rejoinCount > 0).reduce((sum, h) => sum + h.rejoinCount, 0);
            const fakeInvites = leavesCount;

            return i.reply({
                embeds: [embed()
                    .setTitle(`Invite Breakdown - ${u.tag}`)
                    .setDescription(
                        `**Total Invites:** ${total}\n` +
                        `**Valid Invites:** ${total - fakeInvites}\n` +
                        `**Leaves:** ${leavesCount}\n` +
                        `**Rejoins:** ${rejoins}\n` +
                        `**Fake Invites:** ${fakeInvites}`
                    )
                ]
            });
        }

        if (cmd === 'vanitycheck') {
            const vanity = guild.vanityURLCode;
            return i.reply({
                embeds: [embed()
                    .setTitle('Vanity URL Check')
                    .setDescription(vanity
                        ? `This server has a vanity URL: **discord.gg/${vanity}**`
                        : 'This server does not have a vanity URL.'
                    )
                ]
            });
        }

        if (cmd === 'botguilds') {
            if (!isOwner) {
                return i.reply({
                    content: 'This command is only available to the bot owner.',
                    ephemeral: true
                });
            }

            const guilds = Array.from(client.guilds.cache.values());
            const guildsPerPage = 5;
            let currentPage = 0;

            const generatePage = async (page) => {
                const start = page * guildsPerPage;
                const end = start + guildsPerPage;
                const pageGuilds = guilds.slice(start, end);

                let desc = '';

                for (let idx = 0; idx < pageGuilds.length; idx++) {
                    const guild = pageGuilds[idx];
                    const globalIndex = start + idx + 1;
                    let inviteLink = 'Fetching...';

                    const cachedInvite = await getGuildInvite(guild.id);

                    if (cachedInvite && cachedInvite.url) {
                        inviteLink = cachedInvite.url;
                    } else {
                        try {
                            const channels = await guild.channels.fetch();
                            const textChannel = channels.find(ch =>
                                ch.type === ChannelType.GuildText &&
                                ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                            );

                            if (textChannel) {
                                const invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 });
                                inviteLink = invite.url;
                                await saveGuildInvite(guild.id, inviteLink);
                            } else {
                                inviteLink = 'No suitable channel';
                            }
                        } catch (e) {
                            err(`Failed to create invite for guild ${guild.id}:`, e.message);
                            inviteLink = 'Permission denied';
                        }
                    }

                    desc += `**${globalIndex}.** ${guild.name}\n`;
                    desc += `└ **ID:** \`${guild.id}\`\n`;
                    desc += `└ **Members:** ${guild.memberCount}\n`;
                    desc += `└ **Invite:** ${inviteLink}\n\n`;
                }

                const pageEmbed = new EmbedBuilder()
                    .setTitle('Bot Guild List')
                    .setDescription(desc || 'No guilds found.')
                    .setColor(EMBED_COLOR)
                    .setFooter({ text: `Page ${page + 1}/${Math.ceil(guilds.length / guildsPerPage)} • Total: ${guilds.length} guilds` })
                    .setTimestamp();

                const prevBtn = new ButtonBuilder()
                    .setCustomId('guild_prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0);

                const nextBtn = new ButtonBuilder()
                    .setCustomId('guild_next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(end >= guilds.length);

                const refreshBtn = new ButtonBuilder()
                    .setCustomId('guild_refresh')
                    .setLabel('Regenerate Invites')
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(prevBtn, refreshBtn, nextBtn);

                return { embed: pageEmbed, row };
            };

            const { embed: initialEmbed, row: initialRow } = await generatePage(currentPage);
            const response = await i.reply({
                embeds: [initialEmbed],
                components: [initialRow],
                ephemeral: true,
                fetchReply: true
            });

            const collector = response.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async btnInteraction => {
                if (btnInteraction.user.id !== user.id) {
                    return btnInteraction.reply({
                        content: 'This is not your menu!',
                        ephemeral: true
                    });
                }

                if (btnInteraction.customId === 'guild_prev') {
                    currentPage--;
                } else if (btnInteraction.customId === 'guild_next') {
                    currentPage++;
                } else if (btnInteraction.customId === 'guild_refresh') {
                    const start = currentPage * guildsPerPage;
                    const end = start + guildsPerPage;
                    const pageGuilds = guilds.slice(start, end);
                    await Promise.all(pageGuilds.map(g => removeGuildInvite(g.id)));
                }

                const { embed: newEmbed, row: newRow } = await generatePage(currentPage);
                await btnInteraction.update({ embeds: [newEmbed], components: [newRow] });
            });

            collector.on('end', () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('guild_prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('guild_refresh')
                        .setLabel('Regenerate Invites')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('guild_next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                i.editReply({ components: [disabledRow] }).catch(e => err('Failed to disable buttons:', e.message));
            });

            return;
        }

        if (cmd === 'inviteleaderboard') {
            const guildCounts = getData(counts, g);
            const sorted = Array.from(guildCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);

            if (!sorted.length) {
                return i.reply({
                    embeds: [embed()
                        .setTitle('Invite Leaderboard')
                        .setDescription('No invite data available.')
                    ]
                });
            }

            let desc = '';

            for (let idx = 0; idx < sorted.length; idx++) {
                const [userId, count] = sorted[idx];
                const userHistory = Array.from(getData(history, g).values()).filter(h => h.inviterId === userId);
                const joined = userHistory.length;
                const left = userHistory.filter(h => h.left).length;
                const rejoined = userHistory.reduce((sum, h) => sum + h.rejoinCount, 0);
                desc += `**${idx + 1}.** <@${userId}> currently has **${count}** | ${joined} joined, ${left} left, ${rejoined} rejoined\n`;
            }

            return i.reply({
                embeds: [embed()
                    .setTitle('Invite Leaderboard')
                    .setDescription(desc)
                ]
            });
        }

        if (cmd === 'invitelogs') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            logChannels.set(g, options.getChannel('channel').id);
            queueSave();

            return i.reply({
                embeds: [embed()
                    .setTitle('Invite Logs Set')
                    .setDescription(`Invite events will now be logged in ${options.getChannel('channel')}.`)
                ]
            });
        }

        if (cmd === 'resetallinvites') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const confirmBtn = new ButtonBuilder()
                .setCustomId('confirm_reset_all')
                .setLabel('Confirm Reset')
                .setStyle(ButtonStyle.Danger);

            const cancelBtn = new ButtonBuilder()
                .setCustomId('cancel_reset_all')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            return i.reply({
                embeds: [embed()
                    .setTitle('Reset All Invites')
                    .setDescription('This will reset ALL invite data for this server. This action is **irreversible**.\n\nAre you sure you want to continue?')
                ],
                components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)],
                ephemeral: true
            });
        }

        if (cmd === 'exportinvites') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const guildCounts = getData(counts, g);
            const guildHistory = getData(history, g);
            let csv = 'User ID,Total Invites,Leaves,Rejoins,Status\n';

            const allUsers = new Set([
                ...guildCounts.keys(),
                ...Array.from(guildHistory.values()).map(h => h.inviterId).filter(Boolean)
            ]);

            for (const userId of allUsers) {
                const total = guildCounts.get(userId) || 0;
                const leavesCount = getData(leaves, g).get(userId) || 0;
                const userHistory = Array.from(guildHistory.values()).filter(h => h.inviterId === userId);
                const rejoins = userHistory.reduce((sum, d) => sum + d.rejoinCount, 0);
                const hasLeft = userHistory.some(h => h.left);
                csv += `${userId},${total},${leavesCount},${rejoins},${hasLeft ? 'Has Lefts' : 'Active'}\n`;
            }

            return i.reply({
                embeds: [embed()
                    .setTitle('Invite Data Export')
                    .setDescription('```csv\n' + csv.substring(0, 4000) + '\n```')
                ],
                ephemeral: true
            });
        }

        if (cmd === 'resetinvites') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const u = options.getUser('user');
            getData(counts, g).set(u.id, 0);
            queueSave();

            return i.reply({
                embeds: [embed()
                    .setTitle('Invites Reset')
                    .setDescription(`Successfully reset all invite data for ${u}.`)
                ]
            });
        }

        if (cmd === 'addinvites') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const u = options.getUser('user');
            const amt = options.getInteger('amount');
            getData(counts, g).set(u.id, getCount(g, u.id) + amt);
            queueSave();

            return i.reply({
                embeds: [embed()
                    .setTitle('Invites Added')
                    .setDescription(`Added **${amt}** invite${amt !== 1 ? 's' : ''} to ${u}.\n\nNew total: **${getCount(g, u.id)}**`)
                ]
            });
        }

        if (cmd === 'removeinvites') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const u = options.getUser('user');
            const amt = options.getInteger('amount');
            getData(counts, g).set(u.id, Math.max(0, getCount(g, u.id) - amt));
            queueSave();

            return i.reply({
                embeds: [embed()
                    .setTitle('Invites Removed')
                    .setDescription(`Removed **${amt}** invite${amt !== 1 ? 's' : ''} from ${u}.\n\nNew total: **${getCount(g, u.id)}**`)
                ]
            });
        }

        if (cmd === 'invitespanel') {
            if (!isOwner && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
                return i.reply({
                    content: 'You need Administrator permission to use this command.',
                    ephemeral: true
                });
            }

            const ch = options.getChannel('channel');

            const btn = new ButtonBuilder()
                .setCustomId('invite_button')
                .setLabel('click here!')
                .setStyle(ButtonStyle.Secondary);

            await ch.send({
                embeds: [new EmbedBuilder()
                    .setDescription('click the button to see your invites!')
                    .setColor(EMBED_COLOR)
                ],
                components: [new ActionRowBuilder().addComponents(btn)]
            });

            return i.reply({
                embeds: [embed()
                    .setTitle('Panel Sent')
                    .setDescription(`Invite panel has been sent to ${ch}.`)
                ],
                ephemeral: true
            });
        }
    }

    if (i.isButton()) {
        if (i.customId === 'invite_button') {
            const count = getCount(i.guildId, i.user.id);
            return i.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Your Invites')
                    .setDescription(`You have invited **${count}** member${count !== 1 ? 's' : ''} to this server.`)
                    .setColor(EMBED_COLOR)
                    .setTimestamp()
                ],
                ephemeral: true
            });
        }

        if (i.customId === 'confirm_reset_all') {
            counts.delete(i.guildId);
            inviters.delete(i.guildId);
            history.delete(i.guildId);
            leaves.delete(i.guildId);
            queueSave();

            return i.update({
                embeds: [new EmbedBuilder()
                    .setTitle('All Invites Reset')
                    .setDescription('All invite data for this server has been reset.')
                    .setColor(EMBED_COLOR)
                    .setTimestamp()
                ],
                components: []
            });
        }

        if (i.customId === 'cancel_reset_all') {
            return i.update({
                embeds: [new EmbedBuilder()
                    .setTitle('Reset Cancelled')
                    .setDescription('The reset operation has been cancelled.')
                    .setColor(EMBED_COLOR)
                    .setTimestamp()
                ],
                components: []
            });
        }
    }
});

client.login(TOKEN);

process.on('SIGINT', async () => { await saveData(); process.exit(0); });
process.on('SIGTERM', async () => { await saveData(); process.exit(0); });
