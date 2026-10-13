#!/bin/zsh
cd "${0:A:h}"
# Direct connection by default; an explicit YZJ_PROXY overrides it.
python3 server.py
