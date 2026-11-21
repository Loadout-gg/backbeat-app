import { notFound } from "next/navigation"
import { getPromoter } from "@/lib/actions/promoters"
import { PromoterFormPage } from "../../promoter-form-page"

export default async function EditPromoterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const promoter = await getPromoter(id)
  if (!promoter) notFound()
  return <PromoterFormPage promoter={promoter} />
}
