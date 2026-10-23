"""Founder-owned issues: who it's for and how urgent. Adds visible labels on GitHub. Safe to re-run.

    python3 scripts/plan/founders.py
"""
import json, os, subprocess
R = 'repos/trade-marketplace/main'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
S = json.load(open(os.path.join(ROOT, 'docs/plan/issues.json')))
LABELS = [('who: William', '1d76db', 'William needs to do or decide this'), ('who: Matt', 'F28C28', 'Matt needs to do or decide this'),
          ('who: both', '8250df', 'Matt and William together'),
          ('1 · now', 'b60205', 'Founders: do this first, it blocks the first coding tasks'),
          ('2 · next', 'fbca04', 'Founders: soon, it blocks milestone 1 or takes a while to arrange'),
          ('3 · later', 'c2e0c6', 'Founders: before launch or later milestones')]
WHO = {'william': 'who: William', 'matt': 'who: Matt', 'both': 'who: both'}
# key: (who, urgency)
F = {
 'dec-hosting': ('william', 1), 'dec-auth': ('william', 1), 'dec-storage': ('william', 1), 'dec-jobs': ('william', 1), 'dec-rates': ('william', 1),
 'dec-email-sms': ('both', 2), 'dec-licence-check': ('both', 2), 'dec-payroll': ('both', 2), 'dec-materials': ('both', 2),
 'preview': ('william', 2), 'stripe-setup': ('william', 2), 'dec-legal': ('both', 2), 'biz-company': ('both', 2), 'biz-accountant': ('both', 2),
 'dec-ai-fair': ('both', 3), 'dec-bounty-edge': ('both', 3), 'dec-ai-builder': ('both', 3), 'dec-domain': ('matt', 3), 'dec-analytics': ('matt', 3),
 'apple-pay': ('william', 3), 'prod': ('william', 3), 'dec-monitoring': ('william', 3), 'biz-insurance': ('both', 3), 'biz-suppliers': ('both', 3),
 'biz-workers': ('both', 3), 'biz-help-content': ('matt', 3), 'pilot': ('both', 3), 'go-live': ('both', 3), 'dec-2pct': ('both', 3),
}
URG = {1: '1 · now', 2: '2 · next', 3: '3 · later'}

def gh(*a):
    return subprocess.run(['gh', 'api', *a], capture_output=True, text=True)

if __name__ == '__main__':
    have = {l['name'] for l in json.loads(gh(f'{R}/labels?per_page=100').stdout)}
    for n, c, d in LABELS:
        if n not in have:
            gh(f'{R}/labels', '-f', f'name={n}', '-f', f'color={c}', '-f', f'description={d}')
    for k, (who, u) in F.items():
        r = gh('-X', 'POST', f"{R}/issues/{S[k]['number']}/labels", '-f', f'labels[]={WHO[who]}', '-f', f'labels[]={URG[u]}')
        print(S[k]['number'], k, WHO[who], URG[u], 'ok' if r.returncode == 0 else r.stdout[:120])
