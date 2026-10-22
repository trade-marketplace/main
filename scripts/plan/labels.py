"""Labels and milestones for the repo. Safe to re-run: updates existing ones."""
import json, subprocess
R = 'repos/trade-marketplace/main'
LABELS = [
 ('P1', 'b60205', 'Needed for the milestone to be done'), ('P2', 'd93f0b', 'Important, after P1'), ('P3', 'fbca04', 'Nice to have'),
 ('epic', '0C251D', 'A big area of work; holds features'), ('feature', '326C20', 'A group of tasks'),
 ('decision', '5319e7', 'A founder must decide before work continues'), ('idea', 'c5def5', 'Captured for later; not worked on until a founder says so'),
 ('bug', 'd73a4a', 'Something is broken'),
 ('ui', '6CBD45', 'Changes something visible: screenshots required'),
 ('needs-william', '1d76db', 'Schema, money, auth or security: William reviews'),
 ('needs-matt', 'F28C28', 'Brand, copy or look: Matt reviews'),
 ('human-only', '000000', 'Agents do not pick this up'),
 ('port-from-old-repo', 'bfdadc', 'Start from willimobro/Trade-Marketplace, then check against the spec'),
 ('size:S', 'ededed', 'About half a day'), ('size:M', 'cccccc', 'About a day'),
 ('mode:customer', 'A6D754', 'Customer screens (Leaf/Lime)'), ('mode:trade', 'F28C28', 'Tradie screens (Hi-Vis/Amber)'), ('mode:office', '0C251D', 'Office screens (Forest/Mint)'),
]
AREAS = ['setup', 'design-system', 'backend', 'auth', 'public-site', 'customer', 'tradie', 'bounties', 'crews', 'quoters', 'shared', 'office', 'payments', 'system', 'launch']
LABELS += [(f'area:{a}', 'e4e669', f'Area: {a}') for a in AREAS]
MILESTONES = [
 ('0 · Foundations', 'App scaffold, CI, screenshots on PRs, design system, data model, auth.'),
 ('1 · Core job flow', 'Post → price → pay (test) → claim → do → sign off → payout queued. Office can run it.'),
 ('2 · Quote bounties & AI pricing', 'Jobs the AI can’t price become gold $30 bounties; quotes checked for fairness.'),
 ('3 · Launch: Invercargill', 'Public site, legal, emails/SMS, security, monitoring. Real payments only when both founders agree.'),
 ('4 · Crews', 'Team jobs with a lead and splits.'),
 ('5 · Verified quoters', 'Invite-only quoter role, dashboard and earnings.'),
]
def api(*a):
    r = subprocess.run(['gh', 'api', *a], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr
if __name__ == '__main__':
    have = {l['name'] for l in json.loads(api(f'{R}/labels?per_page=100')[1])}
    for n, c, d in LABELS:
        if n in have: api('-X', 'PATCH', f'{R}/labels/{n}', '-f', f'color={c}', '-f', f'description={d}')
        else:
            code, o, e = api(f'{R}/labels', '-f', f'name={n}', '-f', f'color={c}', '-f', f'description={d}')
            if code: print('label fail', n, e)
    ms = {m['title']: m['number'] for m in json.loads(api(f'{R}/milestones?state=all&per_page=100')[1])}
    for t, d in MILESTONES:
        if t not in ms:
            code, o, e = api(f'{R}/milestones', '-f', f'title={t}', '-f', f'description={d}')
            if code: print('ms fail', t, e)
    print('labels', len(json.loads(api(f'{R}/labels?per_page=100')[1])), 'milestones', len(json.loads(api(f'{R}/milestones?state=all')[1])))
