import type {CurrentRequirement} from "./dashboard";

// Shared by the API, screen and exports. File coverage never determines compliance.
export function complianceSummary(rows:CurrentRequirement[]) {
 const ids=[...new Set(rows.map(r=>r.employeeId))];
 const expired=rows.filter(r=>r.overdue).length;
 const reviewing=rows.filter(r=>!r.compliant&&!r.overdue&&r.pendingReview).length;
 const compliant=rows.filter(r=>r.compliant).length;
 const pendingSubmissions=rows.flatMap(r=>r.pendingSubmissions);
 const initialOverdue=rows.filter(r=>r.overdue&&!r.certificateExpired&&!r.reviewOverdue).length;
 return {employees:ids.length,requirements:rows.length,compliant,percent:rows.length?Math.round(compliant/rows.length*100):null,compliantEmployees:ids.filter(id=>rows.filter(r=>r.employeeId===id).every(r=>r.compliant)).length,expired,initialOverdue,expiredCertificates:rows.filter(r=>r.expiryDays!==null&&r.expiryDays<0).length,overdueReviews:rows.filter(r=>r.reviewOverdue&&!r.certificateExpired).length,reviewing,pendingRequirements:rows.length-compliant-expired-reviewing,approachingExpiry:rows.filter(r=>r.expiryDays!==null&&r.expiryDays>=0&&r.expiryDays<=30).length,unverifiedLaw:rows.filter(r=>r.law&&!r.law.verified).length,estimatedLateLawReviews:rows.filter(r=>r.law&&!r.law.verified&&r.law.overdueReviews>0).length,unknownLaw:rows.filter(r=>r.law?.year===null).length,uncertainLawHistory:rows.filter(r=>r.law&&r.law.uncertainReviews>0).length,historicalRequirements:rows.filter(r=>r.recordBasis==="IMPORTED_RECORD").length,requirementsWithFiles:rows.filter(r=>r.attachmentCount>0).length,attachmentCount:rows.reduce((n,r)=>n+r.attachmentCount,0),pending:pendingSubmissions.length,pendingSubmissions};
}
