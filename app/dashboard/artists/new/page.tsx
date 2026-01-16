"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { X, Plus, ChevronRight, FileText, Upload, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createArtist, type CreateArtistInput, type SocialLink } from "@/lib/actions/artists"

const STEPS = [
  { number: 1, label: "General info" },
  { number: 2, label: "Artist overview" },
  { number: 3, label: "Documents" },
  { number: 4, label: "Special requirements" },
]

const MUSIC_GENRES = [
  "Tech House",
  "Drum & Bass",
  "Minimal / Deep Tech",
  "Bass / Club",
  "Latin",
  "House",
  "Afro House / African",
  "Indie Dance / Nu Disco",
  "Hip-Hop / R&B",
  "UK Garage",
  "Techno",
  "Progressive House",
  "Dubstep",
  "Pop / Dance / Electro Pop",
]

const CURRENCIES = ["$", "€", "£", "¥"]
const TRAVEL_FEE_OPTIONS = ["Included", "Not included", "Negotiable", "Per event"]
const SOCIAL_LINK_TYPES = ["Website", "Instagram", "Facebook", "Twitter", "SoundCloud", "Spotify", "YouTube", "TikTok"]

type FormData = {
  // Step 1: General info
  stage_name: string
  name: string
  surname: string
  location: string
  contact_name: string
  phone: string
  email: string
  fee: string
  currency: string
  travel_fee: string
  pricing_notes: string
  social_links: SocialLink[]
  // Step 2: Artist overview
  overview: string
  genres: string[]
  dj_equipment: string
  sound_system: string
  // Step 3: Documents
  documents: { name: string; url: string }[]
  // Step 4: Special requirements
  allergies: string
  special_diet: string
  special_needs: string
}

const initialFormData: FormData = {
  stage_name: "",
  name: "",
  surname: "",
  location: "",
  contact_name: "",
  phone: "",
  email: "",
  fee: "",
  currency: "$",
  travel_fee: "",
  pricing_notes: "",
  social_links: [],
  overview: "",
  genres: [],
  dj_equipment: "",
  sound_system: "",
  documents: [],
  allergies: "",
  special_diet: "",
  special_needs: "",
}

export default function NewArtistPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [newLinkType, setNewLinkType] = useState("")
  const [newLinkUrl, setNewLinkUrl] = useState("")

  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const toggleGenre = (genre: string) => {
    setFormData((prev) => ({
      ...prev,
      genres: prev.genres.includes(genre) ? prev.genres.filter((g) => g !== genre) : [...prev.genres, genre],
    }))
  }

  const addSocialLink = () => {
    if (newLinkType && newLinkUrl) {
      setFormData((prev) => ({
        ...prev,
        social_links: [...prev.social_links, { type: newLinkType, url: newLinkUrl }],
      }))
      setNewLinkType("")
      setNewLinkUrl("")
    }
  }

  const removeSocialLink = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      social_links: prev.social_links.filter((_, i) => i !== index),
    }))
  }

  const handleClose = () => {
    router.push("/dashboard/artists")
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleSubmit = async () => {
    if (!formData.stage_name.trim()) {
      setError("Stage name is required")
      setCurrentStep(1)
      return
    }

    setIsLoading(true)
    setError(null)

    const input: CreateArtistInput = {
      stage_name: formData.stage_name,
      name: formData.name || undefined,
      surname: formData.surname || undefined,
      location: formData.location || undefined,
      contact_name: formData.contact_name || undefined,
      phone: formData.phone || undefined,
      email: formData.email || undefined,
      fee: formData.fee ? Number.parseFloat(formData.fee) : undefined,
      currency: formData.currency || undefined,
      travel_fee: formData.travel_fee || undefined,
      pricing_notes: formData.pricing_notes || undefined,
      social_links: formData.social_links.length > 0 ? formData.social_links : undefined,
      overview: formData.overview || undefined,
      genres: formData.genres.length > 0 ? formData.genres : undefined,
      dj_equipment: formData.dj_equipment || undefined,
      sound_system: formData.sound_system || undefined,
      documents: formData.documents.length > 0 ? formData.documents : undefined,
      allergies: formData.allergies || undefined,
      special_diet: formData.special_diet || undefined,
      special_needs: formData.special_needs || undefined,
    }

    const result = await createArtist(input)

    if (result.success) {
      setShowSuccess(true)
    } else {
      setError(result.error || "Failed to create artist")
      setIsLoading(false)
    }
  }

  const handleSuccessClose = () => {
    setShowSuccess(false)
    router.push("/dashboard/artists")
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h1 className="text-2xl font-semibold">Add Artist</h1>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Stepper */}
          <div className="bg-gray-100 px-6 py-4">
            <div className="flex items-center gap-2">
              {STEPS.map((step, idx) => (
                <div key={step.number} className="flex items-center">
                  <div
                    className={`flex items-center gap-2 ${
                      currentStep === step.number ? "text-black" : "text-gray-500"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium ${
                        currentStep === step.number
                          ? "bg-black text-white"
                          : currentStep > step.number
                            ? "bg-gray-300 text-gray-600"
                            : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {step.number}
                    </span>
                    <span className="text-sm font-medium">{step.label}</span>
                  </div>
                  {idx < STEPS.length - 1 && <ChevronRight className="h-4 w-4 mx-3 text-gray-400" />}
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 p-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md">{error}</div>
            )}

            {/* Step 1: General Info */}
            {currentStep === 1 && (
              <div className="space-y-6">
                {/* Artist Info Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Artist info</h2>
                  <div className="border rounded-lg p-6">
                    <div className="flex gap-6">
                      {/* Image Upload Placeholder */}
                      <div className="flex-shrink-0">
                        <div className="w-40 h-40 rounded-full bg-gray-200 flex items-center justify-center">
                          <Button variant="secondary" size="sm">
                            Upload image
                          </Button>
                        </div>
                      </div>

                      {/* Form Fields */}
                      <div className="flex-1 space-y-4">
                        <div>
                          <Label htmlFor="stage_name">Stage name</Label>
                          <Input
                            id="stage_name"
                            placeholder="Enter stage name"
                            value={formData.stage_name}
                            onChange={(e) => updateField("stage_name", e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="name">Name</Label>
                            <Input
                              id="name"
                              placeholder="Enter artist name"
                              value={formData.name}
                              onChange={(e) => updateField("name", e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="surname">Surname</Label>
                            <Input
                              id="surname"
                              placeholder="Enter artist surname"
                              value={formData.surname}
                              onChange={(e) => updateField("surname", e.target.value)}
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="location">Artist location</Label>
                          <Input
                            id="location"
                            placeholder='Enter artist location (i.e. "Rome, Italy")'
                            value={formData.location}
                            onChange={(e) => updateField("location", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Contact Info Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Contact info</h2>
                  <div className="border rounded-lg p-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="contact_name">Contact name</Label>
                        <Input
                          id="contact_name"
                          placeholder="Contact name"
                          value={formData.contact_name}
                          onChange={(e) => updateField("contact_name", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="phone">Phone number</Label>
                        <Input
                          id="phone"
                          placeholder="Phone number"
                          value={formData.phone}
                          onChange={(e) => updateField("phone", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="Email"
                          value={formData.email}
                          onChange={(e) => updateField("email", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Pricing Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Pricing</h2>
                  <div className="border rounded-lg p-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="fee">Base rate</Label>
                        <div className="flex gap-2">
                          <Select value={formData.currency} onValueChange={(value) => updateField("currency", value)}>
                            <SelectTrigger className="w-16">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            id="fee"
                            type="number"
                            placeholder="2,500"
                            value={formData.fee}
                            onChange={(e) => updateField("fee", e.target.value)}
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="travel_fee">Travel fee</Label>
                        <Select value={formData.travel_fee} onValueChange={(value) => updateField("travel_fee", value)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {TRAVEL_FEE_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="pricing_notes">Additional note</Label>
                        <Input
                          id="pricing_notes"
                          placeholder="Type your note here."
                          value={formData.pricing_notes}
                          onChange={(e) => updateField("pricing_notes", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Social Media Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Social Media and Website</h2>
                  <div className="border rounded-lg p-6 space-y-4">
                    <div className="grid grid-cols-3 gap-4 items-end">
                      <div>
                        <Label>Type of link</Label>
                        <Select value={newLinkType} onValueChange={setNewLinkType}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {SOCIAL_LINK_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Link</Label>
                        <Input placeholder="Link" value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} />
                      </div>
                      <div />
                    </div>
                    <Button variant="default" size="sm" onClick={addSocialLink}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                    </Button>
                    {formData.social_links.length > 0 && (
                      <div className="space-y-2 pt-2">
                        {formData.social_links.map((link, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <span className="text-sm">
                              {link.type}: {link.url}
                            </span>
                            <Button variant="ghost" size="icon" onClick={() => removeSocialLink(idx)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* Step 2: Artist Overview */}
            {currentStep === 2 && (
              <div className="space-y-6">
                {/* Artist Details Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Artist details</h2>
                  <div className="border rounded-lg p-6 space-y-6">
                    <div>
                      <Label htmlFor="overview">About artist</Label>
                      <Textarea
                        id="overview"
                        placeholder="Write a compelling bio about the artist, their background, experience, style, and what makes them unique..."
                        value={formData.overview}
                        onChange={(e) => updateField("overview", e.target.value)}
                        rows={5}
                      />
                    </div>
                    <div>
                      <Label className="mb-3 block">Music Genres</Label>
                      <div className="grid grid-cols-5 gap-3">
                        {MUSIC_GENRES.map((genre) => (
                          <div key={genre} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                            <Checkbox
                              id={`genre-${genre}`}
                              checked={formData.genres.includes(genre)}
                              onCheckedChange={() => toggleGenre(genre)}
                            />
                            <label htmlFor={`genre-${genre}`} className="text-sm cursor-pointer flex-1">
                              {genre}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Equipment Section */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Equipment</h2>
                  <div className="border rounded-lg p-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="dj_equipment">DJ Equipment</Label>
                        <Textarea
                          id="dj_equipment"
                          placeholder="List all equipment the artist provides"
                          value={formData.dj_equipment}
                          onChange={(e) => updateField("dj_equipment", e.target.value)}
                          rows={4}
                        />
                      </div>
                      <div>
                        <Label htmlFor="sound_system">Sound System</Label>
                        <Textarea
                          id="sound_system"
                          placeholder="Specify any technical requirements needed from the venue"
                          value={formData.sound_system}
                          onChange={(e) => updateField("sound_system", e.target.value)}
                          rows={4}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* Step 3: Documents */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <section>
                  <h2 className="text-lg font-medium mb-4">Documents</h2>
                  <div className="border rounded-lg p-6">
                    {/* Upload Area */}
                    <div className="bg-gray-50 border-2 border-dashed rounded-lg p-12 text-center">
                      <FileText className="h-10 w-10 mx-auto mb-4 text-gray-400" />
                      <p className="text-sm font-medium mb-1">Drag and drop documents here or click to upload</p>
                      <p className="text-xs text-blue-500 mb-4">
                        Supported formats: PDF, DOC, DOCX, JPG, PNG (Max 10MB)
                      </p>
                      <Button variant="outline" disabled>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload documents
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2">Coming soon</p>
                    </div>

                    {/* Document List (placeholder for future uploads) */}
                    {formData.documents.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {formData.documents.map((doc, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                              <span className="text-sm">{doc.name}</span>
                            </div>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* Step 4: Special Requirements */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <section>
                  <h2 className="text-lg font-medium mb-1">Special requirements</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Document any special needs, dietary restrictions or accessibility requirements.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="allergies">Allergies</Label>
                      <Textarea
                        id="allergies"
                        placeholder="Specify allergies (i.e. Nuts, Shellfish)"
                        value={formData.allergies}
                        onChange={(e) => updateField("allergies", e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="special_diet">Special Diet</Label>
                      <Textarea
                        id="special_diet"
                        placeholder="Specify dietary requirements, preferences or restrictions (i.e. Vegetarian, Gluten Free)"
                        value={formData.special_diet}
                        onChange={(e) => updateField("special_diet", e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="special_needs">Special Needs & Accessibility</Label>
                      <Textarea
                        id="special_needs"
                        placeholder="Specify special needs and accessibility issues (i.e. Wheelchair accessible, Mobility assistance)"
                        value={formData.special_needs}
                        onChange={(e) => updateField("special_needs", e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                </section>

                {/* Supporting Documentation */}
                <section>
                  <h2 className="text-lg font-medium mb-4">Supporting documentation</h2>
                  <div className="border rounded-lg p-6">
                    <div className="bg-gray-50 border-2 border-dashed rounded-lg p-12 text-center">
                      <FileText className="h-10 w-10 mx-auto mb-4 text-gray-400" />
                      <p className="text-sm font-medium mb-1">Drag and drop documents here or click to upload</p>
                      <p className="text-xs text-blue-500 mb-4">
                        Supported formats: PDF, DOC, DOCX, JPG, PNG (Max 10MB)
                      </p>
                      <Button variant="outline" disabled>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload documents
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2">Coming soon</p>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
            {currentStep > 1 && (
              <Button variant="outline" onClick={handlePrevious} disabled={isLoading}>
                Previous
              </Button>
            )}
            {currentStep < 4 ? (
              <Button onClick={handleNext}>Continue</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save and Complete"
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Success Dialog */}
      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Artist successfully added.</DialogTitle>
          </DialogHeader>
          <div className="flex justify-end pt-4">
            <Button onClick={handleSuccessClose}>Ok</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
