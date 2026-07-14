import { NextRequest, NextResponse } from "next/server";
import { ApolloConfigError, ApolloUserError, searchContacts } from "@/lib/apollo";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const companyName = (body as { companyName?: unknown })?.companyName;
  if (typeof companyName !== "string" || !companyName.trim()) {
    return NextResponse.json({ error: "companyName is required." }, { status: 400 });
  }

  try {
    const result = await searchContacts(companyName.trim());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApolloUserError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ApolloConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("search-contacts failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while searching Apollo. Please try again." },
      { status: 502 }
    );
  }
}
