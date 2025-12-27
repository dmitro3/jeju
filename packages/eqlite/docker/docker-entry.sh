#!/bin/sh

# echo nameserver 114.114.114.114 > /etc/resolv.conf

[ -s "${EQLITE_ALERT}" ] && [ -x "${EQLITE_ALERT}" ] && (eval "${EQLITE_ALERT}")

case "${EQLITE_ROLE}" in
miner)
    exec /app/cql-minerd -config "${EQLITE_CONF}" -metric-web "${METRIC_WEB_ADDR}" "${@}"
    ;;
blockproducer)
    exec /app/cqld -config "${EQLITE_CONF}" -metric-web "${METRIC_WEB_ADDR}" "${@}"
    ;;
explorer)
    exec /app/cql explorer -config "${EQLITE_CONF}" "${@}" "${EQLITE_OBSERVER_ADDR}"
    ;;
adapter)
    exec /app/cql adapter -config "${EQLITE_CONF}" "${@}" "${EQLITE_ADAPTER_ADDR}"
    ;;
mysql-adapter)
    exec /app/cql-mysql-adapter -config "${EQLITE_CONF}" "${@}"
    ;;
cli)
    exec /app/cql console -config ${EQLITE_CONF} "${@}"
    ;;
faucet)
    exec /app/cql-faucet -config ${EQLITE_CONF} "${@}"
    ;;
esac

