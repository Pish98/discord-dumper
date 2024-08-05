# discord-dumping system (codename Arkasha)

This is a simple scripts to collect and view all discord messages, including deleted ones.

## Dependencies
* Node.js
* Npm
  * discord.js
  * discord.js-selfbot-v13
  * request

## Install
```sh
git clone https://github.com/Pish98/discord-dumper.git
cd discord-dumper
npm i discord.js discord.js-selfbot-v13 request
```

## Configure
```sh
cat > bot_run << EOF
#!/bin/sh

export USER_TOKENS='
TOKEN1
TOKEN2
...
'
export BOT_TOKENS='
TOKEN1
TOKEN2
...
'
export LOG_USER_ID= # User ID for receiving startup logs
export PREFIX=!
export DUMP_PATH=data

node bot.js
EOF

chmod +x bot_run

cat > convert_run << EOF
#!/bin/sh

export FILTER_GUILDS='
ID1
ID2
...
'
export EXCLUDE_GUILDS=''
export FILTER_CHANNELS=''
export FILTER_MEMBERS=''

export OUTPUT_FILE=dump.txt
export DUMP_PATH=data

node convert.js
EOF

chmod +x convert_run
```

### Run
```sh
./bot_run # for handle all messages
./convert_run # for convert messages to human-readable format
```

## Bot commands
The first token handles incoming commands and all tokens handle messages. First token can be BOT_TOKENS[0] or USER_TOKENS[0] if BOT_TOKENS is empty.
It is not recommended to handle commands using user tokens.

### !dump
Save all messages from channels to DUMP_PATH/GUILD_ID/CHANNEL_ID.dump and attachments to DUMP_PATH/GUILD_ID/attachments
```
!dump GUILD_IDS and CHANNEL_IDS or all [number]
example:
    !dump 123,234,345
    !dump all # dump all channels
    !dump all 5 # dump 5*100 messages from all channels
```

### !guilds
Get all guilds from all tokens in format GUILD_NAME -> GUILD_ID
```
!guilds
```

### !channels
Get all channels from first token which have guild in format CHANNEL_NAME -> CHANNEL_ID
```
!channels GUILD_ID
example:
    !channels 123
```
