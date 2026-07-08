import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { authenticateRequest } from '../_shared/auth.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface UpdateUserRequest {
  user_id: string
  email?: string
  name?: string
  password?: string
  role?: 'admin' | 'designer'
}

async function findUserByEmail(
  serviceClient: SupabaseClient,
  email: string,
): Promise<User | null> {
  let page = 1

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 100 })
    if (error) {
      throw new HttpError(500, `사용자 조회 실패: ${error.message}`)
    }

    const matched = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (matched) return matched

    if (data.users.length < 100) return null
    page++
  }
}

async function verifyAdmin(serviceClient: SupabaseClient, userId: string): Promise<void> {
  const { data: profile, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new HttpError(500, `프로필 조회 실패: ${error.message}`)
  }

  if (profile?.role !== 'admin') {
    throw new HttpError(403, '관리자만 사용자를 수정할 수 있습니다.')
  }
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    await verifyAdmin(serviceClient, user.id)

    const body = await parseJsonBody<UpdateUserRequest>(req)

    if (!body.user_id) {
      throw new HttpError(400, 'user_id가 필요합니다.')
    }

    if (body.user_id === user.id && body.role && body.role !== 'admin') {
      throw new HttpError(400, '자신의 관리자 역할은 변경할 수 없습니다.')
    }

    const { data: existingProfile, error: profileError } = await serviceClient
      .from('profiles')
      .select('id, email, name, role')
      .eq('id', body.user_id)
      .maybeSingle()

    if (profileError) {
      throw new HttpError(500, `프로필 조회 실패: ${profileError.message}`)
    }

    if (!existingProfile) {
      throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    }

    const authUpdates: Record<string, unknown> = {}

    if (body.email?.trim()) {
      const normalizedEmail = body.email.trim().toLowerCase()
      if (normalizedEmail !== existingProfile.email.toLowerCase()) {
        const duplicate = await findUserByEmail(serviceClient, normalizedEmail)
        if (duplicate && duplicate.id !== body.user_id) {
          throw new HttpError(400, '이미 사용 중인 이메일입니다.')
        }
        authUpdates.email = normalizedEmail
        authUpdates.email_confirm = true
      }
    }

    if (body.password) {
      if (body.password.length < 8) {
        throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.')
      }
      authUpdates.password = body.password
    }

    if (body.name?.trim()) {
      authUpdates.user_metadata = { name: body.name.trim() }
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: updateError } = await serviceClient.auth.admin.updateUserById(
        body.user_id,
        authUpdates,
      )

      if (updateError) {
        throw new HttpError(400, `계정 업데이트 실패: ${updateError.message}`)
      }
    }

    const profileUpdates: Record<string, string> = {}

    if (body.email?.trim()) {
      profileUpdates.email = body.email.trim().toLowerCase()
    }

    if (body.name?.trim()) {
      profileUpdates.name = body.name.trim()
    }

    if (body.role === 'admin' || body.role === 'designer') {
      profileUpdates.role = body.role
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileUpdateError } = await serviceClient
        .from('profiles')
        .update(profileUpdates)
        .eq('id', body.user_id)

      if (profileUpdateError) {
        throw new HttpError(500, `프로필 업데이트 실패: ${profileUpdateError.message}`)
      }
    }

    return jsonResponse({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
})
