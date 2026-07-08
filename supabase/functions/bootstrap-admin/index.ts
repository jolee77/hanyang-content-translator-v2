import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createServiceClient } from '../_shared/auth.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface BootstrapRequest {
  email: string
  name: string
  password: string
  secret: string
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'POST만 허용됩니다.')
    }

    const expectedSecret = Deno.env.get('BOOTSTRAP_SECRET')
    if (!expectedSecret) {
      throw new HttpError(503, 'BOOTSTRAP_SECRET이 설정되지 않았습니다.')
    }

    const { email, name, password, secret } = await parseJsonBody<BootstrapRequest>(req)

    if (secret !== expectedSecret) {
      throw new HttpError(403, '시크릿이 올바르지 않습니다.')
    }

    if (!email?.trim()) {
      throw new HttpError(400, '이메일을 입력해 주세요.')
    }

    if (!name?.trim()) {
      throw new HttpError(400, '이름을 입력해 주세요.')
    }

    if (!password || password.length < 8) {
      throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.')
    }

    const serviceClient = createServiceClient()

    const { count, error: countError } = await serviceClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')

    if (countError) {
      throw new HttpError(500, `관리자 조회 실패: ${countError.message}`)
    }

    if ((count ?? 0) > 0) {
      throw new HttpError(409, '이미 관리자 계정이 존재합니다. bootstrap-admin은 최초 1회만 사용할 수 있습니다.')
    }

    const normalizedEmail = email.trim().toLowerCase()
    const trimmedName = name.trim()

    const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: trimmedName },
    })

    if (createError || !createData.user) {
      throw new HttpError(400, createError?.message ?? '사용자 생성에 실패했습니다.')
    }

    const { error: profileError } = await serviceClient.from('profiles').upsert(
      {
        id: createData.user.id,
        email: normalizedEmail,
        name: trimmedName,
        role: 'admin',
      },
      { onConflict: 'id' },
    )

    if (profileError) {
      throw new HttpError(500, `프로필 생성 실패: ${profileError.message}`)
    }

    return jsonResponse({
      success: true,
      user_id: createData.user.id,
      email: normalizedEmail,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
