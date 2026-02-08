import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pwhqkdivgumrsubpinrv.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// GET: List all clusters
export async function GET() {
  try {
    const { data: clusters, error } = await supabase
      .from('soggetti_cluster')
      .select('*')
      .order('nome_normalizzato')
      .range(0, 9999)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ clusters })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch clusters' }, { status: 500 })
  }
}

// POST: Create or update a cluster
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome_normalizzato, varianti, id } = body

    if (!nome_normalizzato || !varianti || !Array.isArray(varianti)) {
      return NextResponse.json(
        { error: 'Missing required fields: nome_normalizzato and varianti (array)' },
        { status: 400 }
      )
    }

    if (id) {
      // Update existing cluster
      const { data, error } = await supabase
        .from('soggetti_cluster')
        .update({ nome_normalizzato, varianti })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ cluster: data, updated: true })
    } else {
      // Create new cluster
      const { data, error } = await supabase
        .from('soggetti_cluster')
        .insert({ nome_normalizzato, varianti })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Cluster with this name already exists' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ cluster: data, created: true })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save cluster' }, { status: 500 })
  }
}

// DELETE: Remove a cluster
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing cluster id' }, { status: 400 })
    }

    const { error } = await supabase
      .from('soggetti_cluster')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ deleted: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete cluster' }, { status: 500 })
  }
}
