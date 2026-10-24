"""Align baskets of two runs by first-entry time; report match rate up to the earlier run's last trade."""
import sys
sys.path.insert(0, r'E:\ea\clone_work')
from analyze import stats
R = r'C:\Users\User\Documents\Codex\2026-10-08\senior-quant-developer-mt5-reverse-behavior\research\ea_lab\testers\money-heist\reports'
def get(n):
    r, s, O, D, B = stats(R + '/jued_%s.htm' % n, n)
    return [b for b in B if b['entries']]
a, b = get(sys.argv[1]), get(sys.argv[2])
end = min(a[-1]['entries'][-1]['t'], b[-1]['entries'][-1]['t'])
print('last entry', sys.argv[1], a[-1]['entries'][-1]['t'], '|', sys.argv[2], b[-1]['entries'][-1]['t'])
A = [x for x in a if x['entries'][0]['t'] <= end]; Bb = [x for x in b if x['entries'][0]['t'] <= end]
bt = {(x['entries'][0]['t'].replace(second=0), x['side']) for x in Bb}
hit = sum(1 for x in A if (x['entries'][0]['t'].replace(second=0), x['side']) in bt)
print('baskets until', end, ':', len(A), 'vs', len(Bb), '| same minute+side first entry: %d/%d (%.0f%%)' % (hit, len(A), 100 * hit / max(1, len(A))))
for i, (x, y) in enumerate(zip(A, Bb)):
    fx = (x['entries'][0]['t'], x['side'], len(x['entries'])); fy = (y['entries'][0]['t'], y['side'], len(y['entries']))
    if fx[:2] != fy[:2] or fx[2] != fy[2]:
        print('first divergence #%d' % i, fx, fy); break
