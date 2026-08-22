// pumpini.in/leads → pumpini.in/lead
//
// The tool is at /lead (singular) but it gets typed both ways, and a temp who
// lands on a 404 in the field simply stops using it. A redirect costs nothing.
import { redirect } from 'next/navigation';

export default function LeadsAlias() {
  redirect('/lead');
}
