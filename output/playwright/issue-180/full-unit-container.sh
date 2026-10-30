#!/bin/bash
set -euo pipefail
tar -C /source --exclude=src/generated -cf - src tests | tar -C /work -xf -
if [ ! -d /work/.git ]; then cp -a /source/.git /work/.git; fi
cd /work
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm test -- --maxWorkers=1
