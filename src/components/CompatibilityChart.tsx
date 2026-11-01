import { BLOOD_GROUPS } from "@/lib/constants";

/**
 * Explanation for visitors only: nothing is matched with this. Real matching
 * reads the Compatibility table in MySQL through sp_match_donors. The rule is
 * the one sql/05_reference_data.sql derives: a donor can give when their red
 * cells carry no antigen the recipient lacks (27 of the 64 pairs).
 */
const antigens = (group: string) => ({ a: group.includes("A"), b: group.includes("B"), rh: group.endsWith("+") });
function canGive(donor: string, recipient: string) {
  const d = antigens(donor);
  const r = antigens(recipient);
  return (!d.a || r.a) && (!d.b || r.b) && (!d.rh || r.rh);
}

const ORDER = [...BLOOD_GROUPS].sort((x, y) => "O-O+A-A+B-B+AB-AB+".indexOf(x) - "O-O+A-A+B-B+AB-AB+".indexOf(y));

export function CompatibilityChart() {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-1 text-center text-sm">
        <caption className="sr-only">Which donor blood groups can give to which recipient blood groups</caption>
        <thead>
          <tr>
            <th scope="col" className="w-28 px-2 pb-1 text-left text-[13px] leading-tight font-normal text-ink-soft">Donor ↓<br />Recipient →</th>
            {ORDER.map((g) => <th key={g} scope="col" className="pb-1 font-medium tabular">{g}</th>)}
          </tr>
        </thead>
        <tbody>
          {ORDER.map((donor) => (
            <tr key={donor}>
              <th scope="row" className="px-2 text-left font-medium tabular">{donor}</th>
              {ORDER.map((recipient) => {
                const ok = canGive(donor, recipient);
                return (
                  <td key={recipient} className={ok ? "h-8 rounded bg-venous-wash text-venous" : "h-8 rounded bg-elevated/50 text-line"}>
                    <span aria-hidden="true">{ok ? "●" : "·"}</span>
                    <span className="sr-only">{ok ? "Can give" : "Cannot give"}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
