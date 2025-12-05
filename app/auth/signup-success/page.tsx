import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BackbeatLogoFull } from "@/components/backbeat-logo"
import { Mail } from "lucide-react"

export default function SignupSuccessPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <div className="flex justify-center">
            <BackbeatLogoFull />
          </div>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">Check your email</CardTitle>
              <CardDescription>We&apos;ve sent you a confirmation link</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-sm text-muted-foreground">
                Please check your email inbox and click the confirmation link to activate your account. Once confirmed,
                you&apos;ll be able to complete your profile setup.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
