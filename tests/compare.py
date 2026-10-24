"""Compare Money Heist original vs clone reports: entries, spacing, lots, SL/TP, exits, profit, DD."""
import sys, statistics as st
sys.path.insert(0, r'E:\ea\clone_work')
from analyze import stats
R = r'C:\Users\User\Documents\Codex\2026-10-08\senior-quant-developer-mt5-reverse-behavior\research\ea_lab\testers\money-heist\reports'

def row(name):
    r, summ, O, D, B = stats(R + '/jued_%s.htm' % name, name)
    ent = [d for d in D if d['dir'] == 'in']
    hrs = [d['t'].hour for d in ent]
    first = [b['entries'][0]['t'] for b in B]
    hold = [(b['exits'][-1]['t'] - b['entries'][0]['t']).total_seconds() / 60 for b in B if b['exits'] and not b.get('open')]
    sl = sum(1 for d in D if d['dir'] == 'out' and 'sl' in d['cmt'].lower())
    tp = sum(1 for d in D if d['dir'] == 'out' and 'tp' in d['cmt'].lower())
    bp = [sum(x['profit'] + x['comm'] + x['swap'] for x in b['exits']) for b in B if not b.get('open')]
    return [name, r['deals_in'], r['baskets'], r['max_basket'], r['avg_basket'],
            first[0].strftime('%m-%d %H:%M') if first else '-',
            '%02d-%02d' % (min(hrs), max(hrs)) if hrs else '-',
            r['grid_med'], r['lots'][:4], r['max_lot'], '%d/%d' % (sl, tp),
            r['exit_med'], round(st.median(hold)) if hold else '-',
            round(st.median(bp), 1) if bp else '-',
            r['net'], r['pf'], r['eqdd'], r['pending_created'], r['pending_filled']]

H = ['run', 'entries', 'baskets', 'max_bsk', 'avg_bsk', 'first_entry', 'entry_hours', 'grid_med($)',
     'lots', 'max_lot', 'SL/TP hits', 'exit_vs_avg($)', 'hold_med(min)', 'basket_pnl_med', 'net', 'PF', 'equity_DD', 'pend_made', 'pend_filled']
rows = [row(n) for n in sys.argv[1:]]
print('| ' + ' | '.join(H) + ' |'); print('|' + '---|' * len(H))
for x in rows: print('| ' + ' | '.join(str(v) for v in x) + ' |')
