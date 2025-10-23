import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Coordinator {
  user_id: string
  coordination_id: string | null
  division_id: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all submitted events without evaluator assignment
    const { data: pendingEvents, error: eventsError } = await supabase
      .from('events')
      .select(`
        *,
        profiles!inner(team_id, teams!inner(coordination_id, coordinations!inner(division_id)))
      `)
      .eq('status', 'submitted')
      .is('assigned_evaluator_id', null)

    if (eventsError) throw eventsError

    if (!pendingEvents || pendingEvents.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending events to assign' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`Found ${pendingEvents.length} pending events to assign`)

    // Get all coordinators with their areas
    const { data: coordinators, error: coordError } = await supabase
      .from('user_roles')
      .select(`
        user_id,
        profiles!inner(team_id, teams(coordination_id, coordinations(division_id)))
      `)
      .in('role', ['coordenador', 'lider_divisao', 'gerente'])

    if (coordError) throw coordError

    if (!coordinators || coordinators.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No coordinators available' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get evaluation counts for each coordinator (cyclic distribution)
    const { data: evaluationCounts, error: countError } = await supabase
      .from('evaluation_queue')
      .select('assigned_to, count')
      .is('completed_at', null)

    if (countError) throw countError

    const coordinatorCounts = new Map<string, number>()
    evaluationCounts?.forEach((ec: any) => {
      coordinatorCounts.set(ec.assigned_to, parseInt(ec.count) || 0)
    })

    const assignments: any[] = []

    for (const event of pendingEvents) {
      const eventProfile = (event as any).profiles
      const eventCoordId = eventProfile?.teams?.coordination_id
      const eventDivisionId = eventProfile?.teams?.coordinations?.division_id

      // Filter coordinators from OTHER areas
      const eligibleCoordinators = coordinators.filter((coord: any) => {
        const coordProfile = coord.profiles
        const coordCoordId = coordProfile?.teams?.coordination_id
        const coordDivisionId = coordProfile?.teams?.coordinations?.division_id

        // Cross-area evaluation: different coordination or division
        return coordCoordId !== eventCoordId || coordDivisionId !== eventDivisionId
      })

      if (eligibleCoordinators.length === 0) {
        console.log(`No cross-area coordinators available for event ${event.id}`)
        continue
      }

      // Find coordinator with least assignments (cyclic)
      const selectedCoordinator = eligibleCoordinators.reduce((prev: any, curr: any) => {
        const prevCount = coordinatorCounts.get(prev.user_id) || 0
        const currCount = coordinatorCounts.get(curr.user_id) || 0
        return currCount < prevCount ? curr : prev
      })

      // Increment count for selected coordinator
      const currentCount = coordinatorCounts.get(selectedCoordinator.user_id) || 0
      coordinatorCounts.set(selectedCoordinator.user_id, currentCount + 1)

      // Update event with assigned evaluator
      const { error: updateError } = await supabase
        .from('events')
        .update({
          assigned_evaluator_id: selectedCoordinator.user_id,
          assignment_type: 'cross_area'
        })
        .eq('id', event.id)

      if (updateError) {
        console.error(`Error updating event ${event.id}:`, updateError)
        continue
      }

      // Create evaluation queue entry
      const { error: queueError } = await supabase
        .from('evaluation_queue')
        .insert({
          event_id: event.id,
          assigned_to: selectedCoordinator.user_id,
          assigned_at: new Date().toISOString(),
          is_cross_evaluation: true
        })

      if (queueError) {
        console.error(`Error creating queue entry for event ${event.id}:`, queueError)
        continue
      }

      assignments.push({
        event_id: event.id,
        assigned_to: selectedCoordinator.user_id,
        is_cross_evaluation: true
      })

      console.log(`Assigned event ${event.id} to coordinator ${selectedCoordinator.user_id}`)
    }

    return new Response(
      JSON.stringify({
        message: 'Evaluations assigned successfully',
        assignments_count: assignments.length,
        assignments
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error in assign-evaluations:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})