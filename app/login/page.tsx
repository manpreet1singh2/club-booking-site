import { Suspense } from "react";
import { Form } from "./form";

export default function Page() {
  return <Suspense fallback={<main className="pt-32 pb-20" />}><Form /></Suspense>;
}
