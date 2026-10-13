#!/bin/zsh
cd "${0:A:h}"
if [[ -z "${YZJ_PROXY:-}" ]]; then
  task_proxy_host=$(/usr/sbin/scutil --proxy | /usr/bin/awk '/HTTPSProxy :/ {print $3}')
  task_proxy_port=$(/usr/sbin/scutil --proxy | /usr/bin/awk '/HTTPSPort :/ {print $3}')
  if [[ -n "$task_proxy_host" && -n "$task_proxy_port" ]]; then
    export YZJ_PROXY="http://${task_proxy_host}:${task_proxy_port}"
  fi
fi
python3 server.py
