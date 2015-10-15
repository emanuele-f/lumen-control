#!/bin/bash
#
# A script to configure local options and keep them from being commited
#

SECRET_FILE=".secret"
TARGET_FILE="./LightFun/src/com/emanuelef/lightfun/MainActivity.java"
SERVER_LOCAL_STR="SERVER_BLACKSILVER"
SERVER_REMOTE_STR="SERVER_RASPBERRY"

function usage() {
    echo "usage: $0 [--pre-commit | --post-commit | --local [ip] | --remote [ip]]" >&2
    exit 1
}

function substitute_ip() {
    local leftside=$1
    local newright=$2
    
    sed -ri "0,/static final String $leftside = \".*\"/s//static final String $leftside = \"$newright\"/" "$TARGET_FILE"
}

function get_ip() {
    local leftside=$1
    
    REPLY=`grep "static final String $leftside" $TARGET_FILE | awk '{split($0, a, "="); split(a[2], b, "\""); print b[2]; }'`
}

LOCAL_IP=
REMOTE_IP=
MODE=
while [[ "$1" ]]; do
    case "$1" in
    --pre-commit)
        MODE=pre
    ;;
    --post-commit)
        MODE=post
    ;;
    --local)
        shift
        [[ -z "$1" ]] && usage
        LOCAL_IP=$1
    ;;
    --remote) MODE=remote
        shift
        [[ -z "$1" ]] && usage
        REMOTE_IP=$1
    ;;
    *) usage
    esac
    shift
done

if [[ $MODE == pre ]]; then
    # dump existing values to .secret
    get_ip $SERVER_LOCAL_STR
    LOCAL_IP=$REPLY
    get_ip $SERVER_REMOTE_STR
    REMOTE_IP=$REPLY
    echo $LOCAL_IP > $SECRET_FILE
    echo $REMOTE_IP >> $SECRET_FILE
    
    # obfuscate
    LOCAL_IP='x.x.x.x'
    REMOTE_IP='x.x.x.x'
elif [[ $MODE == post ]]; then
    # load existing values from .secret
    exec 3<$SECRET_FILE
    read -u 3
    LOCAL_IP=$REPLY
    read -u 3
    REMOTE_IP=$REPLY
    exec 3<&-
fi

[[ ! -z $LOCAL_IP ]] && substitute_ip $SERVER_LOCAL_STR $LOCAL_IP
[[ ! -z $REMOTE_IP ]] && substitute_ip $SERVER_REMOTE_STR $REMOTE_IP
exit 0
