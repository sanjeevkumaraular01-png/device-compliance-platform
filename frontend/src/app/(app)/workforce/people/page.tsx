import { redirect } from "next/navigation";

/** The people index is the live dashboard; this keeps the breadcrumb link working. */
export default function WorkforcePeopleIndex() {
  redirect("/workforce");
}
