import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMyParentProfileDto } from './dto/student-input.dto';
import { GuardiansService } from './guardians.service';

function service(found: object | null) {
  const repo = { findOne: jest.fn().mockResolvedValue(found) };
  const guardians = new GuardiansService(repo as never, {} as never, {} as never, {} as never);
  const get = jest.spyOn(guardians, 'get').mockResolvedValue({ id: 357 } as never);
  const update = jest.spyOn(guardians, 'update').mockResolvedValue({ id: 357 } as never);
  return { guardians, repo, get, update };
}

describe('parent profile', () => {
  it('reads the profile of the guardian linked to the login', async () => {
    const { guardians, repo, get } = service({ id: 357, school_id: 1 });
    await guardians.profileForUser(517);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { user_id: 517 }, order: { id: 'ASC' } });
    expect(get).toHaveBeenCalledWith(1, 357);
  });

  it('updates only through the linked guardian', async () => {
    const { guardians, update } = service({ id: 357, school_id: 1 });
    await guardians.updateProfileForUser(517, { city: 'Chennai' });
    expect(update).toHaveBeenCalledWith(1, 357, { city: 'Chennai' });
  });

  it('gives a clear error when the login has no parent profile', async () => {
    const { guardians } = service(null);
    await expect(guardians.profileForUser(999)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PARENT_PROFILE_NOT_FOUND' }),
    });
  });

  it('lets the parent change contact details but not name or mobile', () => {
    const allowed = Object.keys(
      plainToInstance(UpdateMyParentProfileDto, {
        alt_mobile: '9840011122',
        email: 'a@b.com',
        occupation: 'Engineer',
        qualification: 'B.E.',
        language: 'ta',
        address_line: '14, Gandhi Street',
        city: 'Chennai',
        pincode: '600040',
      }),
    );
    expect(allowed).toEqual(
      expect.arrayContaining([
        'alt_mobile',
        'email',
        'occupation',
        'qualification',
        'language',
        'address_line',
        'city',
        'pincode',
      ]),
    );
    const dto = new UpdateMyParentProfileDto();
    expect('name' in dto || 'mobile' in dto).toBe(false);
  });

  it('checks pincode and alternate mobile', async () => {
    const errors = await validate(plainToInstance(UpdateMyParentProfileDto, { pincode: '12', alt_mobile: '123' }));
    expect(errors.map((error) => error.property).sort()).toEqual(['alt_mobile', 'pincode']);
  });
});
