#!/bin/sh
echo "Running codeup-pr-review skill..."
echo "Args: $@"
echo "CODEUP_TOKEN is set: $([ -n "$CODEUP_TOKEN" ] && echo yes || echo no)"
echo "CODEUP_API_URL: ${CODEUP_API_URL:-not set}"
